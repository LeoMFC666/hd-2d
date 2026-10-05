/* mGBA â†’ WebAssembly shim.
 *
 * mGBA already has the frontend-facing abstraction the sibling ports had to
 * invent: `struct mCore` is a vtable over "load a ROM, run one frame, hand me
 * pixels and samples", and it is the same struct for the GBA and Game Boy
 * cores. So this file is not a reimplementation of a frontend â€” it is a flat
 * C ABI over mCore, plus the two things a browser needs that mCore does not
 * provide: a tightly-packed RGBA framebuffer and an interleaved int16 pull for
 * an AudioWorklet.
 *
 * Everything here is single-instance on purpose: one page, one emulator.
 */

#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/image.h>
#include <mgba-util/vfs.h>

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#define EXPORT EMSCRIPTEN_KEEPALIVE

#define VIDEO_WIDTH_MAX 256
#define VIDEO_HEIGHT_MAX 224

enum {
	LOG_OFF = 0,
	LOG_ERROR = 1,
	LOG_DEBUG = 2,
};

static struct mCore* core = NULL;

static mColor* videoBuffer = NULL;
static uint32_t* rgbaBuffer = NULL;

static unsigned videoWidth = 0;
static unsigned videoHeight = 0;

static void* romData = NULL;
static size_t romSize = 0;
static void* biosData = NULL;
static size_t biosSize = 0;

static void* sramData = NULL;
static size_t sramSize = 0;

static int logLevel = LOG_ERROR;

/* --------------------------------------------------------------- logging */

static void _log(struct mLogger* logger, int category, enum mLogLevel level,
                 const char* format, va_list args) {
	UNUSED(logger);

	if (logLevel == LOG_OFF) {
		return;
	}

	if (logLevel == LOG_ERROR &&
	    !(level & (mLOG_FATAL | mLOG_ERROR | mLOG_WARN))) {
		return;
	}

	char buffer[512];
	vsnprintf(buffer, sizeof(buffer), format, args);
	printf("[mgba:%s] %s\n", mLogCategoryName(category), buffer);
}

static struct mLogger shimLogger = {
	.log = _log,
	.filter = NULL
};

EXPORT void mgbawasm_set_log_level(int level) {
	logLevel = level;
}

/* ----------------------------------------------------------------- setup */

EXPORT void mgbawasm_init(void) {
	mLogSetDefaultLogger(&shimLogger);
}

static void _freeCore(void) {
	if (core) {
		if (core->unloadROM) {
			core->unloadROM(core);
		}

		mCoreConfigDeinit(&core->config);

		if (core->deinit) {
			core->deinit(core);
		}

		core = NULL;
	}

	free(videoBuffer);
	videoBuffer = NULL;

	free(rgbaBuffer);
	rgbaBuffer = NULL;

	free(romData);
	romData = NULL;
	romSize = 0;

	free(biosData);
	biosData = NULL;
	biosSize = 0;

	free(sramData);
	sramData = NULL;
	sramSize = 0;

	videoWidth = 0;
	videoHeight = 0;
}

EXPORT void mgbawasm_unload(void) {
	_freeCore();
}

/* ----------------------------------------------------------------- load */

EXPORT int mgbawasm_load(const void* rom, int romBytes,
                         const void* bios, int biosBytes,
                         int platform, const char* gbModel,
                         int skipBios) {
	_freeCore();

	if (!rom || romBytes <= 0) {
		return 0;
	}

	romData = malloc((size_t) romBytes);

	if (!romData) {
		return 0;
	}

	memcpy(romData, rom, (size_t) romBytes);
	romSize = (size_t) romBytes;

	struct VFile* romVf = VFileFromMemory(romData, romSize);

	if (!romVf) {
		_freeCore();
		return 0;
	}

	if (platform < 0) {
		core = mCoreCreate(mPLATFORM_GBA);
	} else {
		core = mCoreCreate((enum mPlatform) platform);
	}

	if (!core) {
		romVf->close(romVf);
		_freeCore();
		return 0;
	}

	/*
	 * Validate the mCore vtable before calling through any function pointer.
	 * The custom WebAssembly build previously crashed with:
	 *
	 *     RuntimeError: indirect call to null
	 *
	 * These explicit checks turn that opaque WASM trap into a concrete
	 * diagnostic return code.
	 */

	if (!core->init) {
		romVf->close(romVf);
		_freeCore();
		return -10;
	}

	mCoreInitConfig(core, NULL);

	if (!core->init(core)) {
		romVf->close(romVf);
		_freeCore();
		return 0;
	}

	struct mCoreOptions defaults = {
		.useBios = true,
		.skipBios = skipBios != 0,
		.volume = 0x100,
		.logLevel = mLOG_ALL,
	};

	mCoreConfigLoadDefaults(&core->config, &defaults);

	if (gbModel && gbModel[0]) {
		mCoreConfigSetValue(&core->config, "gb.model", gbModel);
	}

	mCoreLoadConfig(core);

	videoBuffer = calloc(
		VIDEO_WIDTH_MAX * VIDEO_HEIGHT_MAX,
		sizeof(mColor)
	);

	rgbaBuffer = calloc(
		VIDEO_WIDTH_MAX * VIDEO_HEIGHT_MAX,
		sizeof(uint32_t)
	);

	if (!videoBuffer || !rgbaBuffer) {
		romVf->close(romVf);
		_freeCore();
		return 0;
	}

	if (!core->setVideoBuffer) {
		romVf->close(romVf);
		_freeCore();
		return -11;
	}

	core->setVideoBuffer(
		core,
		videoBuffer,
		VIDEO_WIDTH_MAX
	);

	if (!core->setAudioBufferSize) {
		romVf->close(romVf);
		_freeCore();
		return -12;
	}

	core->setAudioBufferSize(core, 0x4000);

	if (!core->loadROM) {
		romVf->close(romVf);
		_freeCore();
		return -13;
	}

	if (!core->loadROM(core, romVf)) {
		romVf->close(romVf);
		_freeCore();
		return 0;
	}

	if (bios && biosBytes > 0) {
		biosData = malloc((size_t) biosBytes);

		if (biosData) {
			memcpy(biosData, bios, (size_t) biosBytes);
			biosSize = (size_t) biosBytes;

			struct VFile* biosVf =
				VFileFromMemory(biosData, biosSize);

			if (biosVf && core->loadBIOS) {
				if (!core->loadBIOS(core, biosVf, 0)) {
					biosVf->close(biosVf);
				}
			} else if (biosVf) {
				biosVf->close(biosVf);
			}
		}
	}

	if (!core->reset) {
		_freeCore();
		return -14;
	}

	if (!core->currentVideoSize) {
		_freeCore();
		return -15;
	}

	core->reset(core);

	core->currentVideoSize(
		core,
		&videoWidth,
		&videoHeight
	);

	return 1;
}

/** `enum mPlatform` of the core that actually got created, or -1. */
EXPORT int mgbawasm_platform(void) {
	return core ? (int) core->platform(core) : -1;
}

EXPORT void mgbawasm_reset(void) {
	if (core) {
		if (core->reset) {
			core->reset(core);
		}

		if (core->currentVideoSize) {
			core->currentVideoSize(
				core,
				&videoWidth,
				&videoHeight
			);
		}
	}
}

/* ------------------------------------------------------------------ video */

EXPORT void mgbawasm_run_frame(void) {
	if (!core) {
		return;
	}

	if (!core->runFrame || !core->currentVideoSize) {
		return;
	}

	core->runFrame(core);

	core->currentVideoSize(
		core,
		&videoWidth,
		&videoHeight
	);

	unsigned width =
		videoWidth > VIDEO_WIDTH_MAX
			? VIDEO_WIDTH_MAX
			: videoWidth;

	unsigned height =
		videoHeight > VIDEO_HEIGHT_MAX
			? VIDEO_HEIGHT_MAX
			: videoHeight;

	for (unsigned y = 0; y < height; ++y) {
		const mColor* src =
			&videoBuffer[y * VIDEO_WIDTH_MAX];

		uint32_t* dst =
			&rgbaBuffer[y * width];

		for (unsigned x = 0; x < width; ++x) {
			dst[x] =
				(uint32_t) src[x] |
				0xFF000000u;
		}
	}
}

EXPORT void* mgbawasm_video_ptr(void) {
	return rgbaBuffer;
}

EXPORT int mgbawasm_video_width(void) {
	return (int) videoWidth;
}

EXPORT int mgbawasm_video_height(void) {
	return (int) videoHeight;
}

EXPORT int mgbawasm_frame_counter(void) {
	if (!core || !core->frameCounter) {
		return 0;
	}

	return (int) core->frameCounter(core);
}

EXPORT int mgbawasm_framerate_micro(void) {
	if (!core ||
	    !core->frameCycles ||
	    !core->frequency) {
		return 0;
	}

	int32_t cycles = core->frameCycles(core);

	if (cycles <= 0) {
		return 0;
	}

	return (int) (
		(double) core->frequency(core) /
		(double) cycles *
		1e6
	);
}

/* ------------------------------------------------------------------ audio */

EXPORT int mgbawasm_sample_rate(void) {
	if (!core || !core->audioSampleRate) {
		return 0;
	}

	return (int) core->audioSampleRate(core);
}

EXPORT int mgbawasm_audio_available(void) {
	if (!core || !core->getAudioBuffer) {
		return 0;
	}

	return (int) mAudioBufferAvailable(
		core->getAudioBuffer(core)
	);
}

EXPORT int mgbawasm_read_audio(int16_t* out, int frames) {
	if (!core ||
	    !out ||
	    frames <= 0 ||
	    !core->getAudioBuffer) {
		return 0;
	}

	return (int) mAudioBufferRead(
		core->getAudioBuffer(core),
		out,
		(size_t) frames
	);
}

/* ------------------------------------------------------------------ input */

EXPORT void mgbawasm_set_keys(unsigned keys) {
	if (core && core->setKeys) {
		core->setKeys(core, keys);
	}
}

/* ------------------------------------------------------------------ bus read */

EXPORT uint32_t mgbawasm_bus_read8(uint32_t address) {
	if (!core || !core->busRead8) {
		return 0;
	}

	return core->busRead8(core, address);
}

EXPORT uint32_t mgbawasm_bus_read16(uint32_t address) {
	if (!core || !core->busRead16) {
		return 0;
	}

	return core->busRead16(core, address);
}

EXPORT uint32_t mgbawasm_bus_read32(uint32_t address) {
	if (!core || !core->busRead32) {
		return 0;
	}

	return core->busRead32(core, address);
}

/* ------------------------------------------------------------- savestates */

EXPORT int mgbawasm_state_size(void) {
	if (!core || !core->stateSize) {
		return 0;
	}

	return (int) core->stateSize(core);
}

EXPORT int mgbawasm_state_save(void* out) {
	if (!core ||
	    !out ||
	    !core->saveState) {
		return 0;
	}

	return core->saveState(core, out) ? 1 : 0;
}

EXPORT int mgbawasm_state_load(const void* in) {
	if (!core ||
	    !in ||
	    !core->loadState) {
		return 0;
	}

	return core->loadState(core, in) ? 1 : 0;
}

/* ------------------------------------------------------------------- SRAM */

EXPORT int mgbawasm_sram_save(void) {
	if (!core || !core->savedataClone) {
		return 0;
	}

	free(sramData);

	sramData = NULL;

	sramSize =
		core->savedataClone(
			core,
			&sramData
		);

	return (int) sramSize;
}

EXPORT void* mgbawasm_sram_ptr(void) {
	return sramData;
}

EXPORT int mgbawasm_sram_load(
	const void* data,
	int bytes
) {
	if (!core ||
	    !data ||
	    bytes <= 0 ||
	    !core->savedataRestore) {
		return 0;
	}

	return core->savedataRestore(
		core,
		data,
		(size_t) bytes,
		true
	) ? 1 : 0;
}

/* ---------------------------------------------------------------- options */

static void _reload(const char* key) {
	if (core &&
	    core->reloadConfigOption) {
		core->reloadConfigOption(
			core,
			key,
			&core->config
		);
	}
}

EXPORT void mgbawasm_set_idle_optimization(int mode) {
	if (!core) {
		return;
	}

	const char* value =
		mode == 0
			? "ignore"
			: (mode == 2 ? "detect" : "remove");

	mCoreConfigSetValue(
		&core->config,
		"idleOptimization",
		value
	);

	_reload("idleOptimization");
}

EXPORT void mgbawasm_set_allow_opposing_directions(int allow) {
	if (!core) {
		return;
	}

	mCoreConfigSetIntValue(
		&core->config,
		"allowOpposingDirections",
		allow ? 1 : 0
	);

	_reload("allowOpposingDirections");
}

EXPORT int mgbawasm_has_bios(void) {
	return biosData ? 1 : 0;
}


