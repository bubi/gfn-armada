#ifndef GFN_ARMADA_COLOR_SPACE_H
#define GFN_ARMADA_COLOR_SPACE_H
#include <gst/video/video.h>

/* Preserve negotiated range. Unsupported/unknown colorimetry stays rejected. */
static inline const char *bridge_bt709_range(const GstVideoColorimetry *color) {
  if(color->matrix!=GST_VIDEO_COLOR_MATRIX_BT709 ||
     color->primaries!=GST_VIDEO_COLOR_PRIMARIES_BT709 ||
     color->transfer!=GST_VIDEO_TRANSFER_BT709) return NULL;
  if(color->range==GST_VIDEO_COLOR_RANGE_16_235) return "limited";
  if(color->range==GST_VIDEO_COLOR_RANGE_0_255) return "full";
  return NULL;
}
#endif
