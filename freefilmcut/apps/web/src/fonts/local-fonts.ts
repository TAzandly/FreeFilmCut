/**
 * Local Font Access API → Troika-fetchable blob URLs.
 * Family names are stored in params; blobs are resolved at runtime.
 *
 * Important: only call queryLocalFonts from a user gesture (font picker open /
 * Retry). Auto-init on page load must NOT prompt or sticky-deny.
 */

import { FCC_BUNDLED_CJK_FONT } from "@/fonts/default-troika-font";

export type LocalFontPermission =
	| "unknown"
	| "granted"
	| "denied"
	| "unsupported";

export type LocalFontEntry = {
	family: string;
	fullName: string;
	postscriptName: string;
	style: string;
};

type FontDataLike = {
	family: string;
	fullName: string;
	postscriptName: string;
	style: string;
	blob: () => Promise<Blob>;
};

declare global {
	interface Window {
		queryLocalFonts?: (options?: {
			postscriptNames?: string[];
		}) => Promise<FontDataLike[]>;
	}
}

const ZH_PREFS = [
	"Microsoft YaHei",
	"微软雅黑",
	"Microsoft YaHei UI",
	"PingFang SC",
	"Hiragino Sans GB",
	"Noto Sans SC",
	"Source Han Sans SC",
	"SimHei",
	"WenQuanYi Micro Hei",
];

const JA_PREFS = [
	"Hiragino Sans",
	"Hiragino Kaku Gothic ProN",
	"Yu Gothic",
	"Noto Sans JP",
	"Meiryo",
];

const KO_PREFS = [
	"Apple SD Gothic Neo",
	"Malgun Gothic",
	"Noto Sans KR",
	"NanumGothic",
];

const EN_PREFS = [
	"Segoe UI",
	"Arial",
	"Helvetica Neue",
	"Helvetica",
	"Roboto",
	"San Francisco",
	"system-ui",
];

let permission: LocalFontPermission = "unknown";
let rawFonts: FontDataLike[] | null = null;
/** Only set when permission === "granted". Denial must leave this null. */
let catalog: LocalFontEntry[] | null = null;
let catalogPromise: Promise<LocalFontEntry[]> | null = null;
/** family|postscript → object URL */
const urlCache = new Map<string, string>();
let preferredFamily = "Noto Sans SC";

function norm(s: string): string {
	return s.trim().toLowerCase();
}

function cacheKey(family: string, postscriptName?: string | null): string {
	const ps = postscriptName?.trim();
	return ps ? `ps:${norm(ps)}` : `fam:${norm(family)}`;
}

export function isLocalFontAccessSupported(): boolean {
	return (
		typeof window !== "undefined" && typeof window.queryLocalFonts === "function"
	);
}

export function getLocalFontPermission(): LocalFontPermission {
	if (!isLocalFontAccessSupported()) return "unsupported";
	return permission;
}

export function getPreferredTextFontFamily(): string {
	return preferredFamily;
}

export function getBundledFallbackFontUrl(): string {
	return FCC_BUNDLED_CJK_FONT;
}

export function getCachedLocalFontUrl(
	family: string,
	postscriptName?: string | null,
): string | null {
	const f = String(family || "").trim();
	if (!f) return null;
	if (postscriptName) {
		const byPs = urlCache.get(cacheKey(f, postscriptName));
		if (byPs) return byPs;
	}
	return urlCache.get(cacheKey(f)) ?? null;
}

function preferenceListForLocale(): string[] {
	const lang = (
		typeof navigator !== "undefined" ? navigator.language : "en"
	).toLowerCase();
	if (lang.startsWith("zh")) return ZH_PREFS;
	if (lang.startsWith("ja")) return JA_PREFS;
	if (lang.startsWith("ko")) return KO_PREFS;
	return EN_PREFS;
}

export function pickDefaultLocalFontFamily({
	fonts,
}: {
	fonts: LocalFontEntry[];
}): string {
	if (fonts.length === 0) return "Noto Sans SC";
	const prefs = preferenceListForLocale();
	for (const pref of prefs) {
		const hit = fonts.find(
			(f) =>
				norm(f.family) === norm(pref) ||
				norm(f.fullName) === norm(pref) ||
				norm(f.family).includes(norm(pref)),
		);
		if (hit) return hit.family;
	}
	return fonts[0]?.family ?? "Noto Sans SC";
}

function dedupeCatalog(fonts: FontDataLike[]): LocalFontEntry[] {
	const byFamily = new Map<string, LocalFontEntry>();
	for (const font of fonts) {
		const key = norm(font.family);
		if (!key) continue;
		const entry: LocalFontEntry = {
			family: font.family,
			fullName: font.fullName,
			postscriptName: font.postscriptName,
			style: font.style,
		};
		const existing = byFamily.get(key);
		if (!existing) {
			byFamily.set(key, entry);
			continue;
		}
		if (isRegularStyle(font.style) && !isRegularStyle(existing.style)) {
			byFamily.set(key, entry);
		}
	}
	return [...byFamily.values()].sort((a, b) =>
		a.family.localeCompare(b.family, undefined, { sensitivity: "base" }),
	);
}

function isRegularStyle(style: string): boolean {
	const s = norm(style);
	if (!s || s === "regular" || s === "normal" || s === "book") return true;
	if (/(bold|black|heavy|light|thin|medium|semibold|italic|oblique)/.test(s)) {
		return false;
	}
	return true;
}

function pickFontData({
	family,
	postscriptName,
}: {
	family: string;
	postscriptName?: string | null;
}): FontDataLike | null {
	if (!rawFonts || rawFonts.length === 0) return null;
	if (postscriptName) {
		const byPs = rawFonts.find(
			(f) => norm(f.postscriptName) === norm(postscriptName),
		);
		if (byPs) return byPs;
	}
	const same = rawFonts.filter((f) => norm(f.family) === norm(family));
	if (same.length === 0) {
		const loose = rawFonts.filter(
			(f) =>
				norm(f.fullName) === norm(family) ||
				norm(f.fullName).includes(norm(family)),
		);
		if (loose.length === 0) return null;
		return (
			loose.find((f) => isRegularStyle(f.style) && !/italic/i.test(f.style)) ||
			loose[0] ||
			null
		);
	}
	return (
		same.find((f) => isRegularStyle(f.style) && !/italic/i.test(f.style)) ||
		same.find((f) => !/italic/i.test(f.style)) ||
		same[0] ||
		null
	);
}

async function readPermissionsState(): Promise<
	"granted" | "denied" | "prompt" | "unknown"
> {
	try {
		const perms = navigator.permissions;
		if (!perms?.query) return "unknown";
		const status = await perms.query({
			name: "local-fonts" as PermissionName,
		});
		if (status.state === "granted") return "granted";
		if (status.state === "denied") return "denied";
		if (status.state === "prompt") return "prompt";
		return "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Request permission (may prompt) and cache the catalog.
 * Pass `force: true` from Retry / picker open so a prior silent failure can recover.
 */
export async function requestLocalFonts({
	force = false,
}: {
	force?: boolean;
} = {}): Promise<LocalFontEntry[]> {
	if (!isLocalFontAccessSupported()) {
		permission = "unsupported";
		return [];
	}

	if (!force && permission === "granted" && catalog) {
		return catalog;
	}
	if (!force && catalogPromise) {
		return catalogPromise;
	}

	if (force) {
		if (permission === "denied") permission = "unknown";
		catalog = null;
		rawFonts = null;
		catalogPromise = null;
	}

	catalogPromise = (async () => {
		try {
			const fonts = await window.queryLocalFonts!();
			permission = "granted";
			rawFonts = fonts;
			catalog = dedupeCatalog(fonts);
			preferredFamily = pickDefaultLocalFontFamily({ fonts: catalog });
			void ensureLocalFontUrl({ family: preferredFamily });
			return catalog;
		} catch {
			permission = "denied";
			rawFonts = null;
			catalog = null;
			return [];
		} finally {
			catalogPromise = null;
		}
	})();

	return catalogPromise;
}

/**
 * Best-effort warm only when the browser already granted local-fonts.
 * Never call queryLocalFonts here without prior grant — that sticky-denies
 * and breaks the picker until refresh.
 */
export async function tryInitLocalFonts(): Promise<string> {
	if (!isLocalFontAccessSupported()) {
		permission = "unsupported";
		return preferredFamily;
	}
	const state = await readPermissionsState();
	if (state === "denied") {
		permission = "denied";
		return preferredFamily;
	}
	if (state !== "granted") {
		permission = "unknown";
		return preferredFamily;
	}
	try {
		await requestLocalFonts({ force: false });
	} catch {
		/* keep Noto preferred */
	}
	return preferredFamily;
}

export async function ensureLocalFontUrl({
	family,
	postscriptName,
}: {
	family: string;
	postscriptName?: string | null;
}): Promise<string | null> {
	const f = String(family || "").trim();
	if (!f) return null;
	if (looksLikeFontUrlOrPackPath(f)) return null;

	const cached = getCachedLocalFontUrl(f, postscriptName);
	if (cached) return cached;

	if (!rawFonts) {
		if (permission === "denied" || permission === "unsupported") return null;
		// Only query if already granted; otherwise wait for picker user gesture.
		const state = await readPermissionsState();
		if (state !== "granted" && permission !== "granted") return null;
		await requestLocalFonts({ force: false });
	}
	const data = pickFontData({ family: f, postscriptName });
	if (!data) return null;

	try {
		const blob = await data.blob();
		const url = URL.createObjectURL(blob);
		urlCache.set(cacheKey(f), url);
		if (data.postscriptName) {
			urlCache.set(cacheKey(f, data.postscriptName), url);
		}
		return url;
	} catch {
		return null;
	}
}

export async function ensureLocalFontsForFamilies({
	families,
}: {
	families: string[];
}): Promise<void> {
	const names = [
		...new Set(
			families
				.map((f) => String(f || "").trim())
				.filter((f) => f && !looksLikeFontUrlOrPackPath(f)),
		),
	];
	if (names.length === 0) return;
	if (!isLocalFontAccessSupported()) return;

	const state = await readPermissionsState();
	if (state === "denied" || permission === "unsupported") return;
	if (state !== "granted" && permission !== "granted") return;

	try {
		await requestLocalFonts({ force: false });
	} catch {
		return;
	}
	if (permission !== "granted") return;

	await Promise.all(
		names.map((family) => ensureLocalFontUrl({ family }).catch(() => null)),
	);
}

export function looksLikeFontUrlOrPackPath(value: string): boolean {
	const f = String(value || "").trim();
	if (!f) return false;
	return (
		f.startsWith("blob:") ||
		f.startsWith("http://") ||
		f.startsWith("https://") ||
		f.startsWith("data:") ||
		f.startsWith("/fonts/") ||
		f.startsWith("fonts/") ||
		f.startsWith("pack/fonts/")
	);
}
