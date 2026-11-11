import {
	BEAUTY_MODELS_BY_ID,
	isBeautyModelId,
} from "@/beauty/analysis/model-catalog";

export const runtime = "edge";

const CONTENT_TYPE: Record<string, string> = {
	faceLandmarker: "application/octet-stream",
	dlmv: "application/onnx",
	selfie: "application/onnx",
};

/**
 * Same-origin proxy for beauty model files. Browsers cannot fetch GitHub
 * release assets (no CORS); the Edge runtime can.
 */
export async function GET(
	_request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	if (!isBeautyModelId(id)) {
		return new Response(`Unknown beauty model: ${id}`, { status: 404 });
	}

	const entry = BEAUTY_MODELS_BY_ID[id];
	let upstream: Response;
	try {
		upstream = await fetch(entry.upstreamUrl, {
			redirect: "follow",
			headers: {
				// Some hosts (HF) behave better with a browser-like Accept.
				Accept: "*/*",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return new Response(`Upstream fetch failed: ${message}`, { status: 502 });
	}

	if (!upstream.ok || !upstream.body) {
		return new Response(
			`Upstream returned HTTP ${upstream.status} for ${id}`,
			{ status: 502 },
		);
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		upstream.headers.get("content-type") || CONTENT_TYPE[id] || "application/octet-stream",
	);
	const length = upstream.headers.get("content-length");
	if (length) headers.set("Content-Length", length);
	headers.set(
		"Cache-Control",
		"public, max-age=31536000, immutable",
	);

	return new Response(upstream.body, {
		status: 200,
		headers,
	});
}
