/**
 * Turn a root-relative asset path into an absolute URL. Workers bundled as
 * `blob:` URLs cannot resolve `/vendor/...` against their own base, but
 * `location.origin` is still the page origin there.
 */
export function resolveAssetUrl(url: string): string {
	if (!url.startsWith("/") || url.startsWith("//")) return url;
	const origin = typeof location !== "undefined" ? location.origin : "";
	return origin && origin !== "null" ? `${origin}${url}` : url;
}
