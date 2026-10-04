#include "color-space.h"
#include <assert.h>
#include <string.h>

int main(void) {
  /* Actual GFN caps recorded on the Portal: 1:3:5:1, full-range BT.709. */
  GstVideoColorimetry color={.range=1,.matrix=3,.transfer=5,.primaries=1};
  assert(strcmp(bridge_bt709_range(&color),"full")==0);
  color.range=GST_VIDEO_COLOR_RANGE_16_235;
  assert(strcmp(bridge_bt709_range(&color),"limited")==0);
  color.range=GST_VIDEO_COLOR_RANGE_UNKNOWN;assert(!bridge_bt709_range(&color));
  color.range=GST_VIDEO_COLOR_RANGE_0_255;
  color.matrix=GST_VIDEO_COLOR_MATRIX_BT601;assert(!bridge_bt709_range(&color));
  color.matrix=GST_VIDEO_COLOR_MATRIX_BT709;
  color.primaries=GST_VIDEO_COLOR_PRIMARIES_UNKNOWN;assert(!bridge_bt709_range(&color));
  color.primaries=GST_VIDEO_COLOR_PRIMARIES_BT709;
  color.transfer=GST_VIDEO_TRANSFER_SMPTE2084;assert(!bridge_bt709_range(&color));
  color.transfer=GST_VIDEO_TRANSFER_UNKNOWN;assert(!bridge_bt709_range(&color));
  return 0;
}
