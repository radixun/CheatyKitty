#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

static void fail(NSString *message) {
  fprintf(stderr, "CheatyKitty capture failed: %s\n", message.UTF8String);
  exit(1);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) fail(@"usage: sck-capture <display-id> <excluded-pid>");
    char *displayEnd = NULL;
    unsigned long displayValue = strtoul(argv[1], &displayEnd, 10);
    if (!displayEnd || *displayEnd != '\0' || displayValue > UINT32_MAX) fail(@"invalid display id");
    CGDirectDisplayID requestedDisplay = (CGDirectDisplayID)displayValue;
    if (requestedDisplay == 0) requestedDisplay = CGMainDisplayID();
    char *pidEnd = NULL;
    long pidValue = strtol(argv[2], &pidEnd, 10);
    if (!pidEnd || *pidEnd != '\0' || pidValue < 0 || pidValue > INT32_MAX) fail(@"invalid excluded process id");
    pid_t excludedPID = (pid_t)pidValue;
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
      if (error) fail(error.localizedDescription);
      SCDisplay *display = nil;
      for (SCDisplay *candidate in content.displays) if (candidate.displayID == requestedDisplay) { display = candidate; break; }
      if (!display) fail(@"requested display is not shareable");
      NSArray<SCRunningApplication *> *excludedApplications = @[];
      if (excludedPID != 0) {
        SCRunningApplication *application = nil;
        for (SCRunningApplication *candidate in content.applications) if (candidate.processID == excludedPID) { application = candidate; break; }
        if (!application) fail(@"CheatyKitty process could not be excluded; capture aborted");
        excludedApplications = @[application];
      }
      SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:excludedApplications exceptingWindows:@[]];
      SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
      configuration.width = display.width;
      configuration.height = display.height;
      configuration.showsCursor = NO;
      configuration.capturesAudio = NO;
      [SCScreenshotManager captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *captureError) {
        if (captureError) fail(captureError.localizedDescription);
        if (!image || CGImageGetWidth(image) == 0 || CGImageGetHeight(image) == 0) fail(@"ScreenCaptureKit returned an empty image");
        NSBitmapImageRep *representation = [[NSBitmapImageRep alloc] initWithCGImage:image];
        NSData *png = [representation representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (!png) fail(@"could not encode captured image as PNG");
        [[NSFileHandle fileHandleWithStandardOutput] writeData:png];
        exit(0);
      }];
    }];
    dispatch_main();
  }
  return 0;
}
