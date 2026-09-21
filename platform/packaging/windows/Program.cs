using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MultiPlatformOperations;

internal sealed class TeamConfiguration
{
    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "unconfigured";

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("token")]
    public string Token { get; set; } = "";
}

internal static class Program
{
    internal static readonly Icon AppIcon =
        Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath)
        ?? SystemIcons.Application;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, "Local\\MultiPlatformOperations.Windows", out var owner);
        if (!owner)
        {
            MessageBox.Show("多平台内容运营已经在运行。", "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Application.Run(new OperationsContext());
    }
}

internal sealed class OperationsContext : ApplicationContext
{
    private readonly string installRoot = AppContext.BaseDirectory;
    private readonly string dataRoot;
    private readonly string configurationPath;
    private readonly string logPath;
    private readonly NotifyIcon tray;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly System.Windows.Forms.Timer probeTimer = new() { Interval = 500 };
    private Process? service;
    private StreamWriter? log;
    private MainWindow? window;
    private TeamConfiguration configuration = new();
    private Uri platformUri = new("http://127.0.0.1:3000");
    private int probeAttempts;
    private bool probing;
    private bool ready;
    private bool closing;

    public OperationsContext()
    {
        dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "多平台内容运营");
        Directory.CreateDirectory(dataRoot);
        configurationPath = Path.Combine(dataRoot, "team-config.json");
        var logs = Path.Combine(dataRoot, "logs");
        Directory.CreateDirectory(logs);
        logPath = Path.Combine(logs, "application.log");

        tray = new NotifyIcon
        {
            Icon = Program.AppIcon,
            Text = "多平台内容运营正在启动…",
            Visible = true,
            ContextMenuStrip = BuildMenu(),
        };
        tray.DoubleClick += (_, _) => ShowWindow();
        probeTimer.Tick += async (_, _) => await ProbeAsync();

        configuration = LoadConfiguration();
        if (!ValidConfiguration(configuration))
        {
            using var setup = new TeamSetupDialog(new TeamConfiguration());
            if (setup.ShowDialog() != DialogResult.OK)
            {
                ExitApplication();
                return;
            }
            configuration = setup.Configuration;
            SaveConfiguration(configuration);
        }
        platformUri = configuration.Mode == "member"
            ? new Uri(configuration.Url)
            : new Uri("http://127.0.0.1:3000");

        window = new MainWindow(dataRoot, platformUri, configuration.Token);
        window.FormClosing += (_, eventArgs) =>
        {
            if (closing) return;
            eventArgs.Cancel = true;
            window.Hide();
            tray.ShowBalloonTip(2500, "多平台内容运营仍在运行", "可双击任务栏托盘图标重新打开，或从托盘菜单完全退出。", ToolTipIcon.Info);
        };
        ShowWindow();
        if (configuration.Mode != "member" && !StartService()) return;
        probeTimer.Start();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开多平台内容运营", null, (_, _) => ShowWindow());
        menu.Items.Add("打开数据文件夹", null, (_, _) => OpenPath(dataRoot));
        menu.Items.Add("局域网团队设置…", null, (_, _) => ConfigureTeam());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出多平台内容运营", null, (_, _) => ExitApplication());
        return menu;
    }

    private bool StartService()
    {
        var node = Path.Combine(installRoot, "resources", "runtime", "node.exe");
        var appRoot = Path.Combine(installRoot, "resources", "app");
        var entry = Path.Combine(appRoot, "scripts", "app-service.mjs");
        if (!File.Exists(node) || !File.Exists(entry))
        {
            Fatal("安装包不完整：找不到内置 Node.js 或服务入口。请重新下载并校验 SHA-256。");
            return false;
        }
        log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = appRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(entry);
        start.Environment["HONGSHUTAI_APP_ROOT"] = appRoot;
        start.Environment["HONGSHUTAI_DATA_ROOT"] = dataRoot;
        start.Environment["NODE_ENV"] = "production";
        start.Environment["HONGSHUTAI_TEAM_MODE"] = configuration.Mode;
        start.Environment["HONGSHUTAI_TEAM_TOKEN"] = configuration.Token;
        service = new Process { StartInfo = start, EnableRaisingEvents = true };
        service.OutputDataReceived += (_, e) => WriteLog(e.Data);
        service.ErrorDataReceived += (_, e) => WriteLog(e.Data);
        service.Exited += (_, _) =>
        {
            if (closing) return;
            tray.Text = "多平台内容运营已停止";
            Fatal($"本地服务意外停止。请查看日志：{logPath}");
        };
        try
        {
            service.Start();
            service.BeginOutputReadLine();
            service.BeginErrorReadLine();
            return true;
        }
        catch (Exception error)
        {
            Fatal($"无法启动本地服务：{error.Message}");
            return false;
        }
    }

    private async Task ProbeAsync()
    {
        if (ready || closing || probing) return;
        probing = true;
        try
        {
            probeAttempts += 1;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(platformUri, "/api/auth"));
                if (!string.IsNullOrWhiteSpace(configuration.Token))
                    request.Headers.Add("Cookie", $"hongshutai_device={configuration.Token}");
                using var response = await http.SendAsync(request);
                if (response.StatusCode == HttpStatusCode.Forbidden)
                {
                    probeTimer.Stop();
                    Fatal("团队主机拒绝了这台设备。请检查主机地址和团队连接码。");
                    return;
                }
                if (response.StatusCode != HttpStatusCode.OK) return;
                ready = true;
                probeTimer.Stop();
                tray.Text = configuration.Mode switch
                {
                    "host" => "多平台内容运营：团队主机运行中",
                    "member" => "多平台内容运营：已连接团队主机",
                    _ => "多平台内容运营运行中",
                };
                if (window is not null) await window.NavigateAsync();
            }
            catch when (probeAttempts <= 120)
            {
                return;
            }
            if (probeAttempts > 120)
            {
                probeTimer.Stop();
                Fatal(configuration.Mode == "member"
                    ? $"无法连接团队主机：{platformUri}\n\n请确认主机正在运行、防火墙允许专用网络访问，并检查连接码。"
                    : $"等待本地服务启动超时。请查看日志：{logPath}");
            }
        }
        finally
        {
            probing = false;
        }
    }

    private void ConfigureTeam()
    {
        using var dialog = new TeamSetupDialog(configuration);
        if (dialog.ShowDialog() != DialogResult.OK) return;
        SaveConfiguration(dialog.Configuration);
        MessageBox.Show("设置已保存。请退出并重新打开多平台内容运营后生效。", "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private TeamConfiguration LoadConfiguration()
    {
        try
        {
            return JsonSerializer.Deserialize<TeamConfiguration>(File.ReadAllText(configurationPath)) ?? new TeamConfiguration();
        }
        catch
        {
            return new TeamConfiguration();
        }
    }

    private void SaveConfiguration(TeamConfiguration next)
    {
        var temporary = configurationPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(next, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temporary, configurationPath, true);
    }

    private static bool ValidConfiguration(TeamConfiguration value)
    {
        if (value.Mode is "standalone") return true;
        if (value.Mode is "host") return value.Token.Length >= 16;
        return value.Mode == "member" && value.Token.Length >= 16 && Uri.TryCreate(value.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";
    }

    private void ShowWindow()
    {
        if (window is null) return;
        window.Show();
        if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
        window.Activate();
    }

    private void WriteLog(string? value)
    {
        if (string.IsNullOrEmpty(value)) return;
        lock (this) log?.WriteLine($"{DateTimeOffset.Now:O} {value}");
    }

    private void Fatal(string message)
    {
        if (window is { IsHandleCreated: true } && window.InvokeRequired)
        {
            window.BeginInvoke(new Action(() => Fatal(message)));
            return;
        }
        MessageBox.Show(message, "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static void OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }

    private void ExitApplication()
    {
        if (closing) return;
        closing = true;
        probeTimer.Stop();
        tray.Visible = false;
        try
        {
            if (service is { HasExited: false }) service.Kill(true);
        }
        catch { }
        log?.Dispose();
        window?.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            http.Dispose();
            probeTimer.Dispose();
            tray.Dispose();
            service?.Dispose();
            log?.Dispose();
            window?.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly string dataRoot;
    private readonly Uri platformUri;
    private readonly string token;
    private Task? initializationTask;

    public MainWindow(string dataRoot, Uri platformUri, string token)
    {
        this.dataRoot = dataRoot;
        this.platformUri = platformUri;
        this.token = token;
        Text = "多平台内容运营";
        Icon = Program.AppIcon;
        Width = 1280;
        Height = 820;
        MinimumSize = new Size(960, 640);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(webView);
    }

    public async Task NavigateAsync()
    {
        try
        {
            initializationTask ??= InitializeWebViewAsync();
            await initializationTask;
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            MessageBox.Show($"未检测到 Microsoft Edge WebView2 Runtime：{error.Message}\n\n请安装 WebView2 Runtime 后重试。", "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        catch (Exception error)
        {
            MessageBox.Show($"无法启动 WebView2：{error.Message}\n\nWebView2 已安装时无需重复安装，请退出程序后查看日志或联系维护者。", "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (!string.IsNullOrWhiteSpace(token))
        {
            var cookie = webView.CoreWebView2.CookieManager.CreateCookie("hongshutai_device", token, platformUri.Host, "/");
            cookie.IsHttpOnly = true;
            cookie.IsSecure = platformUri.Scheme == Uri.UriSchemeHttps;
            cookie.SameSite = CoreWebView2CookieSameSiteKind.Strict;
            webView.CoreWebView2.CookieManager.AddOrUpdateCookie(cookie);
        }
        webView.CoreWebView2.Navigate(platformUri.ToString());
    }

    private async Task InitializeWebViewAsync()
    {
        var userData = Path.Combine(dataRoot, "webview2");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
        await webView.EnsureCoreWebView2Async(environment);
        webView.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
        {
            eventArgs.Handled = true;
            Process.Start(new ProcessStartInfo(eventArgs.Uri) { UseShellExecute = true });
        };
    }
}

internal sealed class TeamSetupDialog : Form
{
    private readonly ComboBox mode = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox address = new();
    private readonly TextBox token = new();
    public TeamConfiguration Configuration { get; private set; }

    public TeamSetupDialog(TeamConfiguration current)
    {
        Configuration = current;
        Text = "多平台内容运营 · 使用方式";
        Icon = Program.AppIcon;
        Width = 560;
        Height = 300;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        mode.Items.AddRange(["独立使用", "创建团队主机", "加入已有团队"]);
        mode.SelectedIndex = current.Mode == "host" ? 1 : current.Mode == "member" ? 2 : 0;
        address.Text = current.Url;
        token.Text = current.Token;
        mode.SelectedIndexChanged += (_, _) => RefreshFields();

        var save = new Button { Text = "保存并开始", DialogResult = DialogResult.None, AutoSize = true };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        save.Click += (_, _) => Save();
        AcceptButton = save;
        CancelButton = cancel;

        var table = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 5 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 115));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.Controls.Add(new Label { Text = "使用方式", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        table.Controls.Add(mode, 1, 0);
        table.Controls.Add(new Label { Text = "主机地址", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        table.Controls.Add(address, 1, 1);
        table.Controls.Add(new Label { Text = "团队连接码", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        table.Controls.Add(token, 1, 2);
        table.Controls.Add(new Label { Text = "团队主机只应在可信家庭或办公室网络中使用。Windows 防火墙询问时，请仅允许专用网络。", AutoSize = true, MaximumSize = new Size(380, 0) }, 1, 3);
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, AutoSize = true };
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        table.Controls.Add(buttons, 1, 4);
        Controls.Add(table);
        RefreshFields();
    }

    private void RefreshFields()
    {
        var host = mode.SelectedIndex == 1;
        var member = mode.SelectedIndex == 2;
        address.Enabled = member;
        token.Enabled = host || member;
        if (host)
        {
            address.Text = LocalHostUrl();
            if (token.Text.Trim().Length < 16) token.Text = Guid.NewGuid().ToString("N");
        }
        else if (!member)
        {
            address.Text = "";
            token.Text = "";
        }
    }

    private void Save()
    {
        var selectedMode = mode.SelectedIndex == 1 ? "host" : mode.SelectedIndex == 2 ? "member" : "standalone";
        var selectedToken = token.Text.Trim();
        var selectedAddress = address.Text.Trim();
        if (selectedMode == "host" && selectedToken.Length < 16) selectedToken = Guid.NewGuid().ToString("N");
        if (selectedMode == "member")
        {
            if (!selectedAddress.Contains("://")) selectedAddress = "http://" + selectedAddress;
            if (!Uri.TryCreate(selectedAddress, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || selectedToken.Length < 16)
            {
                MessageBox.Show("请填写有效的主机地址和至少 16 位团队连接码。", "多平台内容运营", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var builder = new UriBuilder(uri) { Path = "", Query = "", Fragment = "" };
            if (builder.Port == -1) builder.Port = 3000;
            selectedAddress = builder.Uri.ToString().TrimEnd('/');
        }
        Configuration = new TeamConfiguration { Mode = selectedMode, Url = selectedMode == "member" ? selectedAddress : "", Token = selectedToken };
        DialogResult = DialogResult.OK;
        Close();
    }

    private static string LocalHostUrl()
    {
        foreach (var network in NetworkInterface.GetAllNetworkInterfaces().Where(item => item.OperationalStatus == OperationalStatus.Up && item.NetworkInterfaceType != NetworkInterfaceType.Loopback))
        {
            var address = network.GetIPProperties().UnicastAddresses.FirstOrDefault(item => item.Address.AddressFamily == AddressFamily.InterNetwork)?.Address;
            if (address is not null) return $"http://{address}:3000";
        }
        return "http://127.0.0.1:3000";
    }
}
