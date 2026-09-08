#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <arpa/inet.h>
#import <ifaddrs.h>
#import <net/if.h>
#import <signal.h>
#import <unistd.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSTask *service;
@property(nonatomic, strong) NSFileHandle *logHandle;
@property(nonatomic, strong) NSTimer *readyTimer;
@property(nonatomic, strong) NSURL *dataRoot;
@property(nonatomic, strong) NSURL *configurationURL;
@property(nonatomic, strong) NSURL *platformURL;
@property(nonatomic, copy) NSString *teamMode;
@property(nonatomic, copy) NSString *teamToken;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSError *lastProbeError;
@property(nonatomic) NSInteger readyAttempts;
@property(nonatomic) BOOL ready;
@property(nonatomic) BOOL quitting;
@property(nonatomic) BOOL hasSavedMode;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [self loadTeamConfiguration];
  [self configureApplicationMenu];
  [self configureWindow];
  [self configureMenu];
  if (!self.hasSavedMode && ![self runFirstLaunchSetup]) {
    self.quitting = YES;
    [NSApp terminate:nil];
    return;
  }
  [self showLocalNetworkPrimerIfNeeded];
  [self showLoadingPage];
  [self seedDeviceCookieWithCompletion:^{
    if ([self.teamMode isEqualToString:@"member"]) [self startRemoteConnection];
    else [self startService];
  }];
}

- (void)showLocalNetworkPrimerIfNeeded {
  if (![self.teamMode isEqualToString:@"member"]) return;
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  if ([defaults integerForKey:@"LocalNetworkPrimerVersion"] >= 1) return;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"需要访问本地网络";
  alert.informativeText = @"红薯台需要连接同一局域网内的团队主机。接下来如果 macOS 询问是否允许访问本地网络，请选择“允许”。成员模式不会启动本机数据库或小红书 MCP。";
  [alert addButtonWithTitle:@"继续"];
  [alert runModal];
  [defaults setInteger:1 forKey:@"LocalNetworkPrimerVersion"];
  [defaults synchronize];
}

- (void)loadTeamConfiguration {
  NSURL *support = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
  self.dataRoot = [support URLByAppendingPathComponent:@"红薯台" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:self.dataRoot withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:nil];
  self.configurationURL = [self.dataRoot URLByAppendingPathComponent:@"team-config.json"];
  NSDictionary *configuration = nil;
  NSData *data = [NSData dataWithContentsOfURL:self.configurationURL];
  if (data) configuration = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSString *mode = [configuration[@"mode"] isKindOfClass:NSString.class] ? configuration[@"mode"] : @"unconfigured";
  NSString *token = [configuration[@"token"] isKindOfClass:NSString.class] ? configuration[@"token"] : @"";
  NSString *address = [configuration[@"url"] isKindOfClass:NSString.class] ? configuration[@"url"] : @"";
  NSURL *memberURL = [mode isEqualToString:@"member"] ? [NSURL URLWithString:address] : nil;
  BOOL knownMode = [@[@"standalone", @"host", @"member"] containsObject:mode];
  BOOL validHost = ![mode isEqualToString:@"host"] || token.length >= 16;
  BOOL validMember = ![mode isEqualToString:@"member"] || (token.length >= 16 && memberURL.host.length);
  self.hasSavedMode = data != nil && knownMode && validHost && validMember;
  if (!self.hasSavedMode) { mode = @"unconfigured"; token = @""; address = @""; }
  self.teamMode = mode;
  self.teamToken = token;
  self.platformURL = [mode isEqualToString:@"member"] ? [NSURL URLWithString:address] : [NSURL URLWithString:@"http://127.0.0.1:3000"];
  if (!self.platformURL) {
    self.teamMode = @"unconfigured";
    self.hasSavedMode = NO;
    self.platformURL = [NSURL URLWithString:@"http://127.0.0.1:3000"];
  }
}

- (BOOL)saveTeamMode:(NSString *)mode url:(NSString *)url token:(NSString *)token {
  NSDictionary *configuration = @{ @"mode": mode, @"url": url ?: @"", @"token": token ?: @"" };
  NSData *json = [NSJSONSerialization dataWithJSONObject:configuration options:NSJSONWritingPrettyPrinted error:nil];
  if (!json || ![json writeToURL:self.configurationURL options:NSDataWritingAtomic error:nil]) return NO;
  [self loadTeamConfiguration];
  return self.hasSavedMode;
}

- (BOOL)runFirstMemberSetup {
  while (YES) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"加入已有团队";
    alert.informativeText = @"请填写管理员提供的主机地址和团队连接码。这台 Mac 不会启动数据库、运行管理器或小红书 MCP。";
    [alert addButtonWithTitle:@"加入团队"];
    [alert addButtonWithTitle:@"退出"];
    NSView *form = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 430, 84)];
    NSTextField *address = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 48, 430, 28)];
    address.placeholderString = @"主机地址，例如 http://192.168.1.20:3000";
    NSTextField *token = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 5, 430, 28)];
    token.placeholderString = @"团队连接码";
    [form addSubview:address]; [form addSubview:token];
    alert.accessoryView = form;
    if ([alert runModal] != NSAlertFirstButtonReturn) return NO;
    NSString *normalizedURL = [self normalizedTeamURL:address.stringValue];
    NSString *normalizedToken = [token.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!normalizedURL.length || normalizedToken.length < 16) {
      [self showFatal:@"请填写有效的主机地址和至少 16 位团队连接码。"];
      continue;
    }
    if ([self saveTeamMode:@"member" url:normalizedURL token:normalizedToken]) return YES;
    [self showFatal:@"无法保存团队连接设置。"];
  }
}

- (BOOL)runFirstLaunchSetup {
  NSAlert *welcome = [[NSAlert alloc] init];
  welcome.messageText = @"欢迎使用红薯台";
  welcome.informativeText = @"请先选择这台 Mac 的使用方式。作出选择前不会启动任何本地后台服务。";
  [welcome addButtonWithTitle:@"独立使用"];
  [welcome addButtonWithTitle:@"创建团队主机"];
  [welcome addButtonWithTitle:@"加入已有团队"];
  NSModalResponse choice = [welcome runModal];
  if (choice == NSAlertFirstButtonReturn) {
    return [self saveTeamMode:@"standalone" url:@"" token:@""];
  }
  if (choice == NSAlertSecondButtonReturn) {
    NSString *token = [self newTeamToken];
    if (![self saveTeamMode:@"host" url:@"" token:token]) {
      [self showFatal:@"无法保存团队主机设置。"];
      return NO;
    }
    NSString *address = [self teamHostURL];
    NSAlert *created = [[NSAlert alloc] init];
    created.messageText = @"团队主机已创建";
    created.informativeText = [NSString stringWithFormat:@"请把以下信息发给可信成员：\n\n主机地址：%@\n团队连接码：%@\n\n接下来请创建首位管理员账号。", address.length ? address : @"连接网络后在局域网设置中查看", token];
    [created addButtonWithTitle:@"复制连接信息并开始"];
    [created addButtonWithTitle:@"直接开始"];
    if ([created runModal] == NSAlertFirstButtonReturn) {
      NSString *connection = [NSString stringWithFormat:@"主机地址：%@\n团队连接码：%@", address, token];
      [[NSPasteboard generalPasteboard] clearContents];
      [[NSPasteboard generalPasteboard] setString:connection forType:NSPasteboardTypeString];
    }
    return YES;
  }
  if (choice == NSAlertThirdButtonReturn) return [self runFirstMemberSetup];
  return NO;
}

- (void)seedDeviceCookieWithCompletion:(void (^)(void))completion {
  if (!self.teamToken.length || !self.platformURL.host.length) { completion(); return; }
  NSMutableDictionary *properties = [@{
    NSHTTPCookieName: @"hongshutai_device", NSHTTPCookieValue: self.teamToken,
    NSHTTPCookieDomain: self.platformURL.host, NSHTTPCookiePath: @"/",
  } mutableCopy];
  if ([self.platformURL.scheme isEqualToString:@"https"]) properties[NSHTTPCookieSecure] = @YES;
  NSHTTPCookie *cookie = [NSHTTPCookie cookieWithProperties:properties];
  [self.webView.configuration.websiteDataStore.httpCookieStore setCookie:cookie completionHandler:completion];
}

- (void)configureApplicationMenu {
  NSMenu *menuBar = [[NSMenu alloc] init];
  NSMenuItem *applicationItem = [[NSMenuItem alloc] init];
  [menuBar addItem:applicationItem];

  NSMenu *applicationMenu = [[NSMenu alloc] initWithTitle:@"红薯台"];
  [applicationMenu addItemWithTitle:@"关于红薯台" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
  [applicationMenu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *teamItem = [[NSMenuItem alloc] initWithTitle:@"局域网团队设置…" action:@selector(configureTeamMode:) keyEquivalent:@","];
  teamItem.target = self;
  [applicationMenu addItem:teamItem];
  NSMenuItem *privacyItem = [[NSMenuItem alloc] initWithTitle:@"打开本地网络权限设置…" action:@selector(openLocalNetworkSettings:) keyEquivalent:@""];
  privacyItem.target = self;
  [applicationMenu addItem:privacyItem];
  [applicationMenu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出红薯台" action:@selector(quitApplication:) keyEquivalent:@"q"];
  quitItem.target = self;
  [applicationMenu addItem:quitItem];
  applicationItem.submenu = applicationMenu;

  NSMenuItem *editItem = [[NSMenuItem alloc] init];
  [menuBar addItem:editItem];
  NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
  [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
  [editMenu addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
  [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
  [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
  [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
  editItem.submenu = editMenu;
  NSApp.mainMenu = menuBar;
}

- (void)configureWindow {
  NSRect frame = NSMakeRect(0, 0, 1280, 820);
  self.window = [[NSWindow alloc] initWithContentRect:frame
                                            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @"红薯台";
  self.window.minSize = NSMakeSize(960, 640);
  self.window.releasedWhenClosed = NO;
  [self.window center];

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
  self.webView = [[WKWebView alloc] initWithFrame:frame configuration:configuration];
  self.webView.navigationDelegate = self;
  self.webView.UIDelegate = self;
  self.window.contentView = self.webView;
  [self showLoadingPage];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

- (void)showLoadingPage {
  NSString *title = @"红薯台正在启动";
  NSString *hint = @"正在准备本地服务，请稍候…";
  if ([self.teamMode isEqualToString:@"unconfigured"]) {
    title = @"欢迎使用红薯台";
    hint = @"请选择这台 Mac 的使用方式";
  } else if ([self.teamMode isEqualToString:@"member"]) {
    title = @"正在连接团队主机";
    hint = @"成员模式不会启动本机数据库或小红书服务";
  } else if ([self.teamMode isEqualToString:@"host"]) {
    title = @"团队主机正在启动";
    hint = @"正在准备共享工作区，请稍候…";
  }
  NSString *loadingPage = [NSString stringWithFormat:@"<!doctype html><meta charset='utf-8'><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#fffaf7;color:#6d3525;font:16px -apple-system,BlinkMacSystemFont,sans-serif}.box{text-align:center}.icon{font-size:48px;margin-bottom:14px}.hint{color:#9a6b5a;margin-top:8px}</style><div class='box'><div class='icon'>🍠</div><strong>%@</strong><div class='hint'>%@</div></div>", title, hint];
  [self.webView loadHTMLString:loadingPage baseURL:nil];
}

- (void)configureMenu {
  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.button.title = @"🍠";
  self.statusItem.button.toolTip = @"红薯台";

  NSMenu *menu = [[NSMenu alloc] init];
  NSMenuItem *status = [[NSMenuItem alloc] initWithTitle:@"红薯台正在启动…" action:nil keyEquivalent:@""];
  status.tag = 100;
  [menu addItem:status];
  [menu addItem:[NSMenuItem separatorItem]];

  NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"打开红薯台" action:@selector(openPlatform:) keyEquivalent:@"o"];
  openItem.target = self;
  [menu addItem:openItem];
  NSMenuItem *dataItem = [[NSMenuItem alloc] initWithTitle:@"打开数据文件夹" action:@selector(openDataFolder:) keyEquivalent:@""];
  dataItem.target = self;
  [menu addItem:dataItem];
  NSMenuItem *networkItem = [[NSMenuItem alloc] initWithTitle:@"局域网团队设置…" action:@selector(configureTeamMode:) keyEquivalent:@""];
  networkItem.target = self;
  [menu addItem:networkItem];
  NSMenuItem *privacyItem = [[NSMenuItem alloc] initWithTitle:@"打开本地网络权限设置…" action:@selector(openLocalNetworkSettings:) keyEquivalent:@""];
  privacyItem.target = self;
  [menu addItem:privacyItem];
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出红薯台" action:@selector(quitApplication:) keyEquivalent:@"q"];
  quitItem.target = self;
  [menu addItem:quitItem];
  self.statusItem.menu = menu;
}

- (void)setStatusText:(NSString *)text {
  [self.statusItem.menu itemWithTag:100].title = text;
}

- (void)startService {
  NSURL *resources = [NSBundle mainBundle].resourceURL;
  if (!resources) {
    [self showFatal:@"应用资源目录不存在。"];
    return;
  }
  NSURL *appRoot = [resources URLByAppendingPathComponent:@"app" isDirectory:YES];
  NSURL *node = [resources URLByAppendingPathComponent:@"runtime/node"];
  NSURL *logs = [self.dataRoot URLByAppendingPathComponent:@"logs" isDirectory:YES];
  NSURL *logURL = [logs URLByAppendingPathComponent:@"application.log"];
  NSError *error = nil;
  NSDictionary *directoryAttributes = @{NSFilePosixPermissions: @0700};
  if (![[NSFileManager defaultManager] createDirectoryAtURL:logs withIntermediateDirectories:YES attributes:directoryAttributes error:&error]) {
    [self showFatal:[NSString stringWithFormat:@"无法创建本地数据目录：%@", error.localizedDescription]];
    return;
  }
  if (![[NSFileManager defaultManager] fileExistsAtPath:logURL.path]) {
    [[NSFileManager defaultManager] createFileAtPath:logURL.path contents:nil attributes:@{NSFilePosixPermissions: @0600}];
  }
  self.logHandle = [NSFileHandle fileHandleForWritingAtPath:logURL.path];
  [self.logHandle seekToEndOfFile];

  NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
  environment[@"HONGSHUTAI_APP_ROOT"] = appRoot.path;
  environment[@"HONGSHUTAI_DATA_ROOT"] = self.dataRoot.path;
  environment[@"NODE_ENV"] = @"production";
  environment[@"HONGSHUTAI_TEAM_MODE"] = self.teamMode;
  environment[@"HONGSHUTAI_TEAM_TOKEN"] = self.teamToken ?: @"";

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = node;
  task.arguments = @[[[appRoot URLByAppendingPathComponent:@"scripts/app-service.mjs"] path]];
  task.currentDirectoryURL = appRoot;
  task.environment = environment;
  task.standardOutput = self.logHandle;
  task.standardError = self.logHandle;
  __weak AppDelegate *weakSelf = self;
  task.terminationHandler = ^(NSTask *endedTask) {
    dispatch_async(dispatch_get_main_queue(), ^{
      AppDelegate *strongSelf = weakSelf;
      if (!strongSelf || strongSelf.quitting) return;
      [strongSelf setStatusText:@"红薯台已停止"];
      [strongSelf showFatal:[NSString stringWithFormat:@"红薯台服务意外停止（退出码 %d）。\n\n日志位置：%@", endedTask.terminationStatus, logURL.path]];
    });
  };
  if (![task launchAndReturnError:&error]) {
    [self showFatal:[NSString stringWithFormat:@"红薯台无法启动：%@", error.localizedDescription]];
    return;
  }
  self.service = task;
  self.readyAttempts = 0;
  self.readyTimer = [NSTimer scheduledTimerWithTimeInterval:0.5 target:self selector:@selector(checkReady:) userInfo:nil repeats:YES];
  [self.readyTimer fire];
}

- (void)startRemoteConnection {
  self.readyAttempts = 0;
  self.lastProbeError = nil;
  [self setStatusText:@"正在连接团队主机…"];
  self.readyTimer = [NSTimer scheduledTimerWithTimeInterval:0.5 target:self selector:@selector(checkReady:) userInfo:nil repeats:YES];
  [self.readyTimer fire];
}

- (void)checkReady:(NSTimer *)timer {
  if (![self.teamMode isEqualToString:@"member"] && !self.service.running) {
    [timer invalidate];
    return;
  }
  self.readyAttempts += 1;
  if (self.readyAttempts > 120) {
    [timer invalidate];
    if ([self.teamMode isEqualToString:@"member"]) {
      BOOL likelyDenied = self.lastProbeError.code == NSURLErrorNotConnectedToInternet;
      [self setStatusText:likelyDenied ? @"本地网络权限可能未开启" : @"无法连接团队主机"];
      [self showMemberConnectionFailureLikelyDenied:likelyDenied];
    } else {
      [self setStatusText:@"红薯台启动失败"];
      [self showFatal:@"等待本地服务启动超时。请从菜单打开数据文件夹，并查看 logs/application.log。"];
    }
    return;
  }
  NSURL *probeURL = [NSURL URLWithString:@"/api/auth" relativeToURL:self.platformURL].absoluteURL;
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:probeURL];
  request.timeoutInterval = 1;
  if (self.teamToken.length) [request setValue:[NSString stringWithFormat:@"hongshutai_device=%@", self.teamToken] forHTTPHeaderField:@"Cookie"];
  __weak AppDelegate *weakSelf = self;
  NSURLSessionDataTask *probe = [[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
    if (http.statusCode == 403) {
      dispatch_async(dispatch_get_main_queue(), ^{
        AppDelegate *strongSelf = weakSelf;
        if (!strongSelf || strongSelf.ready) return;
        [strongSelf.readyTimer invalidate];
        [strongSelf setStatusText:@"团队连接码无效"];
        [strongSelf showFatal:@"团队主机拒绝了这台设备。请检查主机地址和团队连接码。"];
      });
      return;
    }
    if (error) {
      dispatch_async(dispatch_get_main_queue(), ^{ weakSelf.lastProbeError = error; });
      return;
    }
    if (http.statusCode != 200) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      AppDelegate *strongSelf = weakSelf;
      if (!strongSelf || strongSelf.ready) return;
      strongSelf.ready = YES;
      strongSelf.lastProbeError = nil;
      [strongSelf.readyTimer invalidate];
      NSString *status = [strongSelf.teamMode isEqualToString:@"host"] ? @"团队主机运行中" : [strongSelf.teamMode isEqualToString:@"member"] ? @"已连接团队主机" : @"红薯台运行中";
      [strongSelf setStatusText:status];
      [strongSelf openPlatform:nil];
    });
  }];
  [probe resume];
}

- (void)showMemberConnectionFailureLikelyDenied:(BOOL)likelyDenied {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.alertStyle = NSAlertStyleCritical;
  alert.messageText = likelyDenied ? @"可能未允许访问本地网络" : @"无法连接团队主机";
  alert.informativeText = [NSString stringWithFormat:@"目标主机：%@\n\n请确认“系统设置 → 隐私与安全性 → 本地网络”已允许红薯台，并确认主机保持运行、两台电脑可以互访。", self.platformURL.absoluteString];
  [alert addButtonWithTitle:@"打开本地网络设置"];
  [alert addButtonWithTitle:@"知道了"];
  if ([alert runModal] == NSAlertFirstButtonReturn) [self openLocalNetworkSettings:nil];
}

- (void)openLocalNetworkSettings:(id)sender {
  NSArray<NSString *> *locations = @[
    @"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork",
    @"x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork",
  ];
  for (NSString *location in locations) {
    NSURL *url = [NSURL URLWithString:location];
    if (url && [[NSWorkspace sharedWorkspace] openURL:url]) return;
  }
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension"]];
}

- (void)openPlatform:(id)sender {
  if (self.ready) {
    NSURL *platformURL = self.platformURL;
    NSString *currentHost = self.webView.URL.host.lowercaseString;
    BOOL showingPlatform = [currentHost isEqualToString:platformURL.host.lowercaseString];
    if (!showingPlatform) {
      [self.webView loadRequest:[NSURLRequest requestWithURL:platformURL]];
    }
  }
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)isLocalURL:(NSURL *)url {
  if (!url || [url.scheme isEqualToString:@"about"] || [url.scheme isEqualToString:@"data"]) return YES;
  NSNumber *urlPort = url.port ?: ([url.scheme isEqualToString:@"https"] ? @443 : @80);
  NSNumber *platformPort = self.platformURL.port ?: ([self.platformURL.scheme isEqualToString:@"https"] ? @443 : @80);
  return [url.scheme.lowercaseString isEqualToString:self.platformURL.scheme.lowercaseString]
    && [url.host.lowercaseString isEqualToString:self.platformURL.host.lowercaseString]
    && [urlPort isEqualToNumber:platformPort];
}

- (NSString *)normalizedTeamURL:(NSString *)value {
  NSString *address = [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (![address containsString:@"://"]) address = [@"http://" stringByAppendingString:address];
  NSURLComponents *parts = [NSURLComponents componentsWithString:address];
  if (!parts.host.length || ![@[@"http", @"https"] containsObject:parts.scheme.lowercaseString]) return nil;
  if (!parts.port) parts.port = @3000;
  parts.path = @""; parts.query = nil; parts.fragment = nil;
  return parts.URL.absoluteString;
}

- (NSString *)localIPv4Address {
  struct ifaddrs *interfaces = NULL;
  if (getifaddrs(&interfaces) != 0) return @"";
  NSString *preferred = @"";
  NSString *fallback = @"";
  for (struct ifaddrs *item = interfaces; item != NULL; item = item->ifa_next) {
    if (!item->ifa_addr || item->ifa_addr->sa_family != AF_INET) continue;
    if (!(item->ifa_flags & IFF_UP) || (item->ifa_flags & IFF_LOOPBACK)) continue;
    char address[INET_ADDRSTRLEN] = {0};
    struct sockaddr_in *socketAddress = (struct sockaddr_in *)item->ifa_addr;
    if (!inet_ntop(AF_INET, &socketAddress->sin_addr, address, sizeof(address))) continue;
    NSString *value = [NSString stringWithUTF8String:address];
    if (!fallback.length) fallback = value;
    if (strcmp(item->ifa_name, "en0") == 0) { preferred = value; break; }
  }
  freeifaddrs(interfaces);
  return preferred.length ? preferred : fallback;
}

- (NSString *)teamHostURL {
  NSString *address = [self localIPv4Address];
  return address.length ? [NSString stringWithFormat:@"http://%@:3000", address] : @"";
}

- (NSString *)newTeamToken {
  return [[NSUUID.UUID.UUIDString stringByReplacingOccurrencesOfString:@"-" withString:@""] lowercaseString];
}

- (void)teamModeSelectionChanged:(NSPopUpButton *)sender {
  NSView *form = sender.superview;
  NSTextField *address = [form viewWithTag:202];
  NSTextField *token = [form viewWithTag:203];
  BOOL host = sender.indexOfSelectedItem == 1;
  BOOL member = sender.indexOfSelectedItem == 2;
  address.editable = member;
  if (host) {
    address.stringValue = [self teamHostURL];
    address.placeholderString = @"未检测到局域网地址，请先连接 Wi-Fi 或网线";
    if (token.stringValue.length < 16) token.stringValue = [self newTeamToken];
  } else if (member) {
    address.stringValue = [self.teamMode isEqualToString:@"member"] ? self.platformURL.absoluteString : @"";
    address.placeholderString = @"主机地址，例如 http://192.168.1.20:3000";
  } else {
    address.stringValue = @"";
    address.placeholderString = @"单机模式无需主机地址";
  }
}

- (void)copyTeamConnection:(NSButton *)sender {
  NSView *form = sender.superview;
  NSString *address = [(NSTextField *)[form viewWithTag:202] stringValue];
  NSString *token = [(NSTextField *)[form viewWithTag:203] stringValue];
  if (!address.length || token.length < 16) {
    NSBeep();
    return;
  }
  NSString *connection = [NSString stringWithFormat:@"主机地址：%@\n团队连接码：%@", address, token];
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  [pasteboard setString:connection forType:NSPasteboardTypeString];
  sender.title = @"已复制";
}

- (void)configureTeamMode:(id)sender {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"局域网团队设置";
  alert.informativeText = @"单机：数据只在本机。主机：团队共用本机数据。成员：连接主机，不启动本地服务。保存后需退出并重新打开红薯台。";
  [alert addButtonWithTitle:@"保存"];
  [alert addButtonWithTitle:@"取消"];
  NSView *form = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 420, 174)];
  NSPopUpButton *mode = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(0, 142, 420, 26)];
  [mode addItemsWithTitles:@[@"单机模式", @"团队主机", @"团队成员"]];
  mode.tag = 201;
  NSInteger selected = [self.teamMode isEqualToString:@"host"] ? 1 : [self.teamMode isEqualToString:@"member"] ? 2 : 0;
  [mode selectItemAtIndex:selected];
  mode.target = self;
  mode.action = @selector(teamModeSelectionChanged:);
  NSTextField *address = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 98, 420, 28)];
  address.tag = 202;
  address.selectable = YES;
  NSTextField *token = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 55, 420, 28)];
  token.placeholderString = @"团队连接码（主机自动生成，成员从主机复制）";
  token.stringValue = self.teamToken ?: @"";
  token.tag = 203;
  NSButton *copyButton = [[NSButton alloc] initWithFrame:NSMakeRect(260, 10, 160, 30)];
  copyButton.title = @"复制连接信息";
  copyButton.bezelStyle = NSBezelStyleRounded;
  copyButton.target = self;
  copyButton.action = @selector(copyTeamConnection:);
  [form addSubview:mode]; [form addSubview:address]; [form addSubview:token];
  [form addSubview:copyButton];
  [self teamModeSelectionChanged:mode];
  alert.accessoryView = form;
  if ([alert runModal] != NSAlertFirstButtonReturn) return;

  NSString *newMode = mode.indexOfSelectedItem == 1 ? @"host" : mode.indexOfSelectedItem == 2 ? @"member" : @"standalone";
  NSString *newToken = [token.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *newURL = @"";
  if ([newMode isEqualToString:@"host"] && newToken.length < 16) newToken = [self newTeamToken];
  if ([newMode isEqualToString:@"member"]) {
    newURL = [self normalizedTeamURL:address.stringValue];
    if (!newURL.length || newToken.length < 16) {
      [self showFatal:@"团队成员必须填写有效的主机地址和至少 16 位团队连接码。"];
      return;
    }
  }
  NSDictionary *configuration = @{ @"mode": newMode, @"url": newURL, @"token": newToken };
  NSData *json = [NSJSONSerialization dataWithJSONObject:configuration options:NSJSONWritingPrettyPrinted error:nil];
  if (![json writeToURL:self.configurationURL options:NSDataWritingAtomic error:nil]) {
    [self showFatal:@"无法保存局域网团队设置。"];
    return;
  }
  NSString *detail = [newMode isEqualToString:@"host"]
    ? [NSString stringWithFormat:@"团队主机已配置。请把连接码发给可信成员：\n\n%@\n\n请完全退出并重新打开红薯台。", newToken]
    : @"设置已保存。请完全退出并重新打开红薯台。";
  NSAlert *saved = [[NSAlert alloc] init]; saved.messageText = @"设置已保存"; saved.informativeText = detail; [saved runModal];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  NSURL *url = navigationAction.request.URL;
  if ([self isLocalURL:url]) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  if (url) [[NSWorkspace sharedWorkspace] openURL:url];
  decisionHandler(WKNavigationActionPolicyCancel);
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)navigationAction
    windowFeatures:(WKWindowFeatures *)windowFeatures {
  NSURL *url = navigationAction.request.URL;
  if ([self isLocalURL:url]) {
    [webView loadRequest:navigationAction.request];
  } else if (url) {
    [[NSWorkspace sharedWorkspace] openURL:url];
  }
  return nil;
}

- (void)openDataFolder:(id)sender {
  if (self.dataRoot) [[NSWorkspace sharedWorkspace] openURL:self.dataRoot];
}

- (void)quitApplication:(id)sender {
  self.quitting = YES;
  [self setStatusText:@"红薯台正在退出…"];
  [self stopService];
  [NSApp terminate:nil];
}

- (void)stopService {
  [self.readyTimer invalidate];
  if (self.service.running) {
    [self.service terminate];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:6];
    while (self.service.running && [deadline timeIntervalSinceNow] > 0) usleep(100000);
    if (self.service.running) kill(self.service.processIdentifier, SIGKILL);
  }
  [self.logHandle closeFile];
}

- (void)showFatal:(NSString *)message {
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [[NSAlert alloc] init];
  alert.alertStyle = NSAlertStyleCritical;
  alert.messageText = @"红薯台";
  alert.informativeText = message;
  [alert addButtonWithTitle:@"知道了"];
  [alert runModal];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  self.quitting = YES;
  [self stopService];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return NO;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  [self openPlatform:nil];
  return YES;
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *application = [NSApplication sharedApplication];
    AppDelegate *delegate = [[AppDelegate alloc] init];
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
