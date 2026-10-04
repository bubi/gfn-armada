/* Isolated Linux experiment. No raw pixel mapping or software decoder fallback. */
#include <node_api.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <gst/allocators/gstdmabuf.h>
#include <gst/video/video.h>
#include <gst/video/video-info-dma.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

#define MAX_LEASES 8
typedef struct { GstSample *sample; uint32_t id; } Lease;
typedef struct {
  GstElement *pipeline, *sink, *source;
  Lease leases[MAX_LEASES];
  uint32_t next_id;
} Bridge;

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, NULL, message); return NULL;
}
static napi_value object(napi_env env) { napi_value v; napi_create_object(env, &v); return v; }
static napi_value number(napi_env env, double n) { napi_value v; napi_create_double(env, n, &v); return v; }
static napi_value string(napi_env env, const char *s) {
  napi_value v; napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v); return v;
}
static void set(napi_env env, napi_value obj, const char *key, napi_value value) {
  napi_set_named_property(env, obj, key, value);
}
static napi_value null_value(napi_env env) { napi_value v; napi_get_null(env, &v); return v; }
static Bridge *context(napi_env env) { Bridge *b; napi_get_instance_data(env, (void **)&b); return b; }
static unsigned outstanding(Bridge *b) {
  unsigned count = 0; for (unsigned i=0; i<MAX_LEASES; i++) count += b->leases[i].sample != NULL;
  return count;
}
static void stop(Bridge *b) {
  if (b->pipeline) { gst_element_set_state(b->pipeline, GST_STATE_NULL); gst_object_unref(b->pipeline); }
  if (b->sink) gst_object_unref(b->sink);
  if (b->source) gst_object_unref(b->source);
  b->pipeline = b->sink = b->source = NULL;
}
static void cleanup(napi_env env, void *data, void *hint) {
  (void)env; (void)hint; Bridge *b=data;
  stop(b);
  for (unsigned i=0; i<MAX_LEASES; i++) if (b->leases[i].sample) gst_sample_unref(b->leases[i].sample);
  g_free(b);
}
static GstPadProbeReturn allocation(GstPad *pad, GstPadProbeInfo *info, gpointer data) {
  (void)pad; (void)data;
  GstQuery *query=GST_PAD_PROBE_INFO_QUERY(info);
  if (GST_QUERY_TYPE(query)==GST_QUERY_ALLOCATION && gst_query_is_writable(query) &&
      !gst_query_find_allocation_meta(query, GST_VIDEO_META_API_TYPE, NULL))
    gst_query_add_allocation_meta(query, GST_VIDEO_META_API_TYPE, NULL);
  return GST_PAD_PROBE_OK;
}
static napi_value start_pipeline(napi_env env, Bridge *b) {
  b->sink=gst_bin_get_by_name(GST_BIN(b->pipeline),"output");
  GstPad *pad=gst_element_get_static_pad(b->sink,"sink");
  gst_pad_add_probe(pad,GST_PAD_PROBE_TYPE_QUERY_DOWNSTREAM,allocation,NULL,NULL); gst_object_unref(pad);
  if (gst_element_set_state(b->pipeline,GST_STATE_PLAYING)==GST_STATE_CHANGE_FAILURE) {
    stop(b); return fail(env,"V4L2 pipeline failed to start");
  }
  GstElement *decoder=gst_bin_get_by_name(GST_BIN(b->pipeline),"decoder");
  gchar *device=NULL; g_object_get(decoder,"device",&device,NULL); gst_object_unref(decoder);
  napi_value result=object(env); set(env,result,"device",string(env,device ? device : "unknown"));
  g_free(device); return result;
}
static napi_value open_stream(napi_env env, napi_callback_info info) {
  (void)info; Bridge *b=context(env);
  if(b->pipeline || outstanding(b)) return fail(env,"Bridge already open or frames still leased");
  GError *error=NULL;
  b->pipeline=gst_parse_launch("appsrc name=input is-live=true format=time block=false max-buffers=8 max-bytes=4194304 "
    "caps=\"video/x-h264,stream-format=byte-stream,alignment=au\" ! h264parse ! v4l2h264dec name=decoder ! "
    "appsink name=output caps=\"video/x-raw(memory:DMABuf),format=DMA_DRM,drm-format=NV12\" "
    "sync=false max-buffers=2 drop=false enable-last-sample=false", &error);
  if(error || !b->pipeline) {
    if(error) g_error_free(error);
    stop(b); return fail(env,"Required explicit v4l2h264dec pipeline unavailable");
  }
  b->source=gst_bin_get_by_name(GST_BIN(b->pipeline),"input");
  return start_pipeline(env,b);
}
static napi_value push_frame(napi_env env, napi_callback_info info) {
  Bridge *b=context(env); size_t argc=3,length; napi_value args[3]; void *bytes;
  double timestamp; bool key;
  napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if(!b->source) return fail(env,"H264 stream is not open");
  bool is_buffer=false; if(argc) napi_is_buffer(env,args[0],&is_buffer);
  if(argc!=3 || !is_buffer || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok ||
     !length || length>2097152 || napi_get_value_double(env,args[1],&timestamp)!=napi_ok ||
     !isfinite(timestamp) || timestamp<0 || timestamp>9007199254740.0 ||
     napi_get_value_bool(env,args[2],&key)!=napi_ok)
    return fail(env,"Expected bounded Annex-B Buffer, timestamp microseconds, keyframe boolean");
  unsigned char *data=bytes;
  if(length<4 || data[0]!=0 || data[1]!=0 || !(data[2]==1 || (data[2]==0 && data[3]==1)))
    return fail(env,"Only Annex-B access units are supported");
  gboolean accepted=FALSE;
  if(gst_app_src_get_current_level_buffers(GST_APP_SRC(b->source))<8 &&
     gst_app_src_get_current_level_bytes(GST_APP_SRC(b->source))+length<=4194304) {
    GstBuffer *buffer=gst_buffer_new_allocate(NULL,length,NULL);
    gst_buffer_fill(buffer,0,bytes,length); // Compressed bytes only; never maps raw decoder output.
    GST_BUFFER_PTS(buffer)=(GstClockTime)(timestamp*1000.0);
    if(!key) GST_BUFFER_FLAG_SET(buffer,GST_BUFFER_FLAG_DELTA_UNIT);
    accepted=gst_app_src_push_buffer(GST_APP_SRC(b->source),buffer)==GST_FLOW_OK;
  }
  napi_value result; napi_get_boolean(env,accepted,&result); return result;
}
static napi_value open_file(napi_env env, napi_callback_info info) {
  Bridge *b=context(env); size_t argc=1, size; napi_value arg;
  napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
  if (argc!=1 || napi_get_value_string_utf8(env,arg,NULL,0,&size)!=napi_ok || !size || size>4096)
    return fail(env,"openFile requires a local clip path (max 4096 bytes)");
  if (b->pipeline || outstanding(b)) return fail(env,"Bridge already open or frames still leased");
  char *path=g_malloc(size+1); napi_get_value_string_utf8(env,arg,path,size+1,&size);
  GError *error=NULL;
  b->pipeline=gst_parse_launch("filesrc name=input ! h265parse ! v4l2h265dec name=decoder ! "
    "appsink name=output caps=\"video/x-raw(memory:DMABuf),format=DMA_DRM,drm-format=NV12\" "
    "sync=false max-buffers=2 drop=false", &error);
  if (error || !b->pipeline) {
    g_free(path); if(error) g_error_free(error); stop(b);
    return fail(env,"Required explicit v4l2h265dec pipeline unavailable");
  }
  GstElement *src=gst_bin_get_by_name(GST_BIN(b->pipeline),"input");
  g_object_set(src,"location",path,NULL); gst_object_unref(src); g_free(path);
  return start_pipeline(env,b);
}
static napi_value pull_frame(napi_env env, napi_callback_info info) {
  Bridge *b=context(env); size_t argc=1; napi_value arg; uint32_t timeout=0;
  napi_get_cb_info(env,info,&argc,&arg,NULL,NULL);
  if (!b->pipeline) return fail(env,"Bridge is not open");
  if (argc!=1 || napi_get_value_uint32(env,arg,&timeout)!=napi_ok || timeout>100)
    return fail(env,"pullFrame timeout must be 0..100 ms");
  unsigned slot=0; while(slot<MAX_LEASES && b->leases[slot].sample) slot++;
  if(slot==MAX_LEASES) return fail(env,"DMA-BUF lease limit reached");
  GstSample *sample=gst_app_sink_try_pull_sample(GST_APP_SINK(b->sink),timeout*GST_MSECOND);
  if (!sample) {
    GstBus *bus=gst_element_get_bus(b->pipeline);
    GstMessage *msg=gst_bus_pop_filtered(bus,GST_MESSAGE_ERROR); gst_object_unref(bus);
    if (msg) {
      GError *error=NULL; gchar *debug=NULL; gst_message_parse_error(msg,&error,&debug);
      napi_value result=fail(env,error ? error->message : "GStreamer decode error");
      if(error) g_error_free(error);
      g_free(debug); gst_message_unref(msg); return result;
    }
    napi_value result=object(env); napi_value eos;
    napi_get_boolean(env,gst_app_sink_is_eos(GST_APP_SINK(b->sink)),&eos); set(env,result,"eos",eos);
    return result;
  }
  GstBuffer *buffer=gst_sample_get_buffer(sample);
  GstVideoInfoDmaDrm drm; gst_video_info_dma_drm_init(&drm);
  GstVideoMeta *meta=gst_buffer_get_video_meta(buffer);
  gsize plane_size[GST_VIDEO_MAX_PLANES]; guint heights[GST_VIDEO_MAX_PLANES];
  const char *invalid=NULL;char color_error[200];
  if(!gst_video_info_dma_drm_from_caps(&drm,gst_sample_get_caps(sample)) ||
     drm.drm_fourcc!=gst_video_dma_drm_fourcc_from_format(GST_VIDEO_FORMAT_NV12) || drm.drm_modifier!=0)
    invalid="Only explicitly negotiated linear NV12 DMA-BUF is supported";
  else if(!meta || meta->format!=GST_VIDEO_FORMAT_NV12 || meta->n_planes!=2 ||
          !gst_video_meta_get_plane_size(meta,plane_size) || !gst_video_meta_get_plane_height(meta,heights))
    invalid="Missing or inconsistent NV12 GstVideoMeta alignment";
  else if(meta->alignment.padding_top || meta->alignment.padding_left ||
          heights[0] % 2 || heights[1]!=heights[0]/2 ||
          meta->width!=(guint)GST_VIDEO_INFO_WIDTH(&drm.vinfo) ||
          meta->height!=(guint)GST_VIDEO_INFO_HEIGHT(&drm.vinfo) || gst_buffer_get_video_crop_meta(buffer))
    invalid="Unsupported crop or padded frame geometry";
  else if(drm.vinfo.colorimetry.matrix!=GST_VIDEO_COLOR_MATRIX_BT709 ||
          drm.vinfo.colorimetry.primaries!=GST_VIDEO_COLOR_PRIMARIES_BT709 ||
          drm.vinfo.colorimetry.transfer!=GST_VIDEO_TRANSFER_BT709 ||
          drm.vinfo.colorimetry.range!=GST_VIDEO_COLOR_RANGE_16_235) {
    g_snprintf(color_error,sizeof(color_error),"First prototype requires negotiated limited-range BT.709 (range=%u matrix=%u transfer=%u primaries=%u)",
      (unsigned)drm.vinfo.colorimetry.range,(unsigned)drm.vinfo.colorimetry.matrix,
      (unsigned)drm.vinfo.colorimetry.transfer,(unsigned)drm.vinfo.colorimetry.primaries);
    invalid=color_error;
  }
  napi_value planes; napi_create_array_with_length(env,2,&planes);
  if(!invalid) for(unsigned p=0;p<2;p++) {
    guint idx,length; gsize skip,offset,maxsize;
    if(meta->stride[p]<=0 || !gst_buffer_find_memory(buffer,meta->offset[p],plane_size[p],&idx,&length,&skip) || length!=1) {
      invalid="Plane does not fit one DMA-BUF memory"; break;
    }
    GstMemory *memory=gst_buffer_peek_memory(buffer,idx);
    gst_memory_get_sizes(memory,&offset,&maxsize);
    if(!gst_is_dmabuf_memory(memory) || offset>maxsize || skip>maxsize-offset ||
       plane_size[p]>maxsize-offset-skip) { invalid="Invalid DMA-BUF plane bounds"; break; }
    napi_value plane=object(env);
    set(env,plane,"fd",number(env,gst_dmabuf_memory_get_fd(memory)));
    set(env,plane,"stride",number(env,meta->stride[p]));
    set(env,plane,"offset",number(env,offset+skip));
    set(env,plane,"size",number(env,plane_size[p]));
    napi_set_element(env,planes,p,plane);
  }
  if(invalid) { gst_sample_unref(sample); return fail(env,invalid); }
  napi_value texture=object(env), coded=object(env), rect=object(env), handle=object(env), pixmap=object(env);
  set(env,coded,"width",number(env,meta->width+meta->alignment.padding_right));
  set(env,coded,"height",number(env,heights[0]));
  set(env,rect,"x",number(env,0)); set(env,rect,"y",number(env,0));
  set(env,rect,"width",number(env,meta->width)); set(env,rect,"height",number(env,meta->height));
  set(env,pixmap,"planes",planes); set(env,pixmap,"modifier",string(env,"0"));
  napi_value zero_copy; napi_get_boolean(env,false,&zero_copy);
  set(env,pixmap,"supportsZeroCopyWebGpuImport",zero_copy); set(env,handle,"nativePixmap",pixmap);
  set(env,texture,"pixelFormat",string(env,"nv12")); set(env,texture,"codedSize",coded);
  set(env,texture,"visibleRect",rect); set(env,texture,"handle",handle);
  napi_value color=object(env);
  set(env,color,"matrix",string(env,"bt709")); set(env,color,"primaries",string(env,"bt709"));
  set(env,color,"transfer",string(env,"bt709")); set(env,color,"range",string(env,"limited"));
  set(env,texture,"colorSpace",color);
  if(GST_BUFFER_PTS_IS_VALID(buffer)) set(env,texture,"timestamp",number(env,GST_BUFFER_PTS(buffer)/1000));
  b->leases[slot]=(Lease){sample,++b->next_id};
  napi_value result=object(env); set(env,result,"leaseId",number(env,b->next_id));
  set(env,result,"textureInfo",texture); set(env,result,"outstanding",number(env,outstanding(b)));
  return result;
}
static napi_value release_frame(napi_env env, napi_callback_info info) {
  Bridge *b=context(env); size_t argc=1; napi_value arg; uint32_t id;
  napi_get_cb_info(env,info,&argc,&arg,NULL,NULL);
  if(argc!=1 || napi_get_value_uint32(env,arg,&id)!=napi_ok) return fail(env,"Invalid frame lease");
  for(unsigned i=0;i<MAX_LEASES;i++) if(b->leases[i].sample && b->leases[i].id==id) {
    gst_sample_unref(b->leases[i].sample); b->leases[i].sample=NULL; return null_value(env);
  }
  return fail(env,"Unknown or already released frame lease");
}
static napi_value close_bridge(napi_env env, napi_callback_info info) {
  (void)info; Bridge *b=context(env);
  if(outstanding(b)) return fail(env,"Frames still leased: wait for allReferencesReleased before close");
  stop(b); return null_value(env);
}
static napi_value init(napi_env env, napi_value exports) {
  gst_init(NULL,NULL); Bridge *b=g_new0(Bridge,1);
  napi_set_instance_data(env,b,cleanup,NULL);
  napi_property_descriptor methods[]={
    {"openStream",NULL,open_stream,NULL,NULL,NULL,napi_default,NULL},
    {"pushFrame",NULL,push_frame,NULL,NULL,NULL,napi_default,NULL},
    {"openFile",NULL,open_file,NULL,NULL,NULL,napi_default,NULL},
    {"pullFrame",NULL,pull_frame,NULL,NULL,NULL,napi_default,NULL},
    {"releaseFrame",NULL,release_frame,NULL,NULL,NULL,napi_default,NULL},
    {"close",NULL,close_bridge,NULL,NULL,NULL,napi_default,NULL}
  };
  napi_define_properties(env,exports,6,methods); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
