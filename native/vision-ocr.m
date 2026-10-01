#import <AppKit/AppKit.h>
#import <Vision/Vision.h>

static void fail(NSString *message) {
  fprintf(stderr, "CheatyKitty OCR failed: %s\n", message.UTF8String);
  exit(1);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) fail(@"usage: vision-ocr <png-path>");
    NSString *imagePath = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:imagePath];
    if (!image) fail(@"could not read the captured PNG");
    CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (!cgImage) fail(@"could not decode the captured PNG");

    __block NSError *recognitionError = nil;
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(__kindof VNRequest *completedRequest, NSError *completedError) {
      recognitionError = completedError;
    }];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.recognitionLanguages = @[@"en-US", @"ru-RU"];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error] || recognitionError) {
      NSError *failure = error ?: recognitionError;
      fail(failure ? [NSString stringWithFormat:@"%@ (%@ %ld)", failure.localizedDescription, failure.domain, (long)failure.code] : @"Vision found no readable text");
    }

    NSArray<VNRecognizedTextObservation *> *observations = request.results ?: @[];
    observations = [observations sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *left, VNRecognizedTextObservation *right) {
      CGFloat leftTop = CGRectGetMaxY(left.boundingBox);
      CGFloat rightTop = CGRectGetMaxY(right.boundingBox);
      if (fabs(leftTop - rightTop) > 0.012) return leftTop > rightTop ? NSOrderedAscending : NSOrderedDescending;
      CGFloat leftX = CGRectGetMinX(left.boundingBox);
      CGFloat rightX = CGRectGetMinX(right.boundingBox);
      if (leftX == rightX) return NSOrderedSame;
      return leftX < rightX ? NSOrderedAscending : NSOrderedDescending;
    }];

    NSMutableArray *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in observations) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      NSString *text = [candidate.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
      if (text.length == 0) continue;
      CGRect box = observation.boundingBox;
      [lines addObject:@{
        @"text": text,
        @"confidence": @(candidate.confidence),
        @"x": @(box.origin.x),
        @"y": @(box.origin.y),
        @"width": @(box.size.width),
        @"height": @(box.size.height)
      }];
    }
    if (lines.count == 0) fail(@"Vision found no readable text");
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{ @"lines": lines } options:0 error:&error];
    if (!json) fail(error.localizedDescription ?: @"could not encode OCR JSON");
    [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
  }
  return 0;
}
