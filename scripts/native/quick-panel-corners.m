#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <string.h>

static void maskMaterial(NSView *view, NSImage *mask) {
    if ([view isKindOfClass:NSVisualEffectView.class]) {
        ((NSVisualEffectView *)view).maskImage = mask;
    } else {
        for (NSView *child in view.subviews) maskMaterial(child, mask);
    }
}

static napi_value roundPanel(napi_env env, napi_callback_info info) {
    size_t argc = 1, size = 0;
    napi_value arg;
    void *data = NULL;
    napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
    if (argc != 1 || napi_get_buffer_info(env, arg, &data, &size) != napi_ok || size != sizeof(void *)) {
        napi_throw_type_error(env, NULL, "Expected Electron's native window handle");
        return NULL;
    }
    void *pointer;
    memcpy(&pointer, data, sizeof(pointer));
    NSWindow *window = [(__bridge NSView *)pointer window];
    NSView *content = window.contentView;
    CGFloat radius = 18, side = radius * 2 + 1;
    NSImage *mask = [NSImage imageWithSize:NSMakeSize(side, side) flipped:NO drawingHandler:^BOOL(NSRect rect) {
        [NSColor.blackColor setFill];
        [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
        return YES;
    }];
    mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
    mask.resizingMode = NSImageResizingModeStretch;
    content.wantsLayer = YES;
    content.layer.cornerRadius = radius;
    content.layer.masksToBounds = YES;
    maskMaterial(content, mask);
    [window invalidateShadow];
    return NULL;
}

NAPI_MODULE_INIT() {
    napi_value fn;
    napi_create_function(env, "roundPanel", NAPI_AUTO_LENGTH, roundPanel, NULL, &fn);
    return fn;
}
