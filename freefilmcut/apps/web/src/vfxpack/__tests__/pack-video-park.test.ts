/**
 * fcc-tl-flower-68: out-of-frame pack parking.
 *
 * `pausePackSceneVideos` is what makes "vfxpack 的 clip 时间之外，内部视频不
 * 播放" true: the compositor calls it every frame for built packs that were not
 * drawn, because `syncPackVideos` only visits packs renderOnePack drew and
 * `setPackVideoPreviewState` only covers a *stopped* transport.
 *
 * The park must (a) mute + pause a free-running element, (b) reset the play
 * session so re-entering the clip force-seeks from the clip position instead of
 * resuming mid-media, and (c) leave objects without a pack video untouched.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { pausePackSceneVideos } from "@/vfxpack/pack-video";

type FakeVideo = {
	muted: boolean;
	volume: number;
	paused: boolean;
	currentTime: number;
	pauseCalls: number;
};

function fakeVideo(overrides?: Partial<FakeVideo>): FakeVideo & HTMLVideoElement {
	const el: FakeVideo & { pause(): void } = {
		muted: false,
		volume: 0.8,
		paused: false,
		currentTime: 1.25,
		pauseCalls: 0,
		...overrides,
		pause() {
			el.paused = true;
			el.pauseCalls += 1;
		},
	};
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test stub, pausePackSceneVideos only touches muted/volume/paused
	return el as unknown as FakeVideo & HTMLVideoElement;
}

function nodeWithVideo(video: FakeVideo & HTMLVideoElement): THREE.Object3D {
	const obj = new THREE.Object3D();
	(obj.userData as Record<string, unknown>).__fccVideo = video;
	return obj;
}

describe("pausePackSceneVideos", () => {
	test("mutes, pauses and resets the play session of a free-running video", () => {
		const video = fakeVideo();
		const root = new THREE.Object3D();
		root.add(nodeWithVideo(video));
		(root.children[0].userData as Record<string, unknown>).__fccTlWantPlay = true;
		(root.children[0].userData as Record<string, unknown>).__fccTlStartSeekDone = true;
		(root.children[0].userData as Record<string, unknown>).__fccTlInRange = true;

		pausePackSceneVideos({ root });

		expect(video.muted).toBe(true);
		expect(video.volume).toBe(0);
		expect(video.paused).toBe(true);
		expect(video.pauseCalls).toBe(1);
		const ud = root.children[0].userData as Record<string, unknown>;
		expect(ud.__fccTlWantPlay).toBe(false);
		// Session reset: re-entering the clip must force the start seek again
		// instead of resuming from wherever the stale session left off.
		expect(ud.__fccTlStartSeekDone).toBe(false);
		expect(ud.__fccTlInRange).toBe(false);
		expect(ud.__fccTlIdleParked).toBe(true);
		expect(ud.__fccTlSeekTarget).toBe(1.25);
	});

	test("is a no-op for objects without a pack video", () => {
		const root = new THREE.Object3D();
		const plain = new THREE.Object3D();
		(plain.userData as Record<string, unknown>).__fccMediaCache = { gen: 1 };
		root.add(plain);

		expect(() => pausePackSceneVideos({ root })).not.toThrow();
		const ud = plain.userData as Record<string, unknown>;
		expect(ud.__fccTlIdleParked).toBeUndefined();
	});

	test("is idempotent on an already parked video", () => {
		const video = fakeVideo({ paused: true, muted: true, volume: 0 });
		const root = new THREE.Object3D();
		root.add(nodeWithVideo(video));

		pausePackSceneVideos({ root });
		pausePackSceneVideos({ root });

		expect(video.pauseCalls).toBe(0);
		expect(video.muted).toBe(true);
	});

	test("parks videos nested deep in the pack scene", () => {
		const video = fakeVideo();
		const root = new THREE.Object3D();
		const deep = new THREE.Object3D();
		deep.add(nodeWithVideo(video));
		const mid = new THREE.Object3D();
		mid.add(deep);
		root.add(mid);

		pausePackSceneVideos({ root });

		expect(video.paused).toBe(true);
	});
});
