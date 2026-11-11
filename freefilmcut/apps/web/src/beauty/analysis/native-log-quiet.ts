/**
 * MediaPipe / ORT spam known-harmless lines through console (Next.dev turns
 * some into red "Console Error"). Filter only those while native work runs.
 */
const QUIET_PATTERNS = [
	/Created TensorFlow Lite XNNPACK delegate/i,
	/tf_half_pixel_for_nn/i,
	/upsamplebase\.h/i,
];

const METHODS = ["log", "info", "warn", "debug", "error"] as const;

type ConsoleMethod = (typeof METHODS)[number];

function shouldQuiet(args: unknown[]): boolean {
	const text = args
		.map((arg) => (typeof arg === "string" ? arg : ""))
		.join(" ");
	return QUIET_PATTERNS.some((re) => re.test(text));
}

/** Run `fn` with known MediaPipe/ORT noise lines filtered from console. */
export function withQuietNativeLogs<T>(fn: () => T): T {
	if (typeof console === "undefined") return fn();
	const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
	for (const method of METHODS) {
		const original = console[method].bind(console) as (
			...args: unknown[]
		) => void;
		originals.set(method, original);
		console[method] = ((...args: unknown[]) => {
			if (shouldQuiet(args)) return;
			original(...args);
		}) as (typeof console)[ConsoleMethod];
	}
	try {
		return fn();
	} finally {
		for (const method of METHODS) {
			const original = originals.get(method);
			if (original) console[method] = original as (typeof console)[ConsoleMethod];
		}
	}
}

export async function withQuietNativeLogsAsync<T>(
	fn: () => Promise<T>,
): Promise<T> {
	if (typeof console === "undefined") return fn();
	const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
	for (const method of METHODS) {
		const original = console[method].bind(console) as (
			...args: unknown[]
		) => void;
		originals.set(method, original);
		console[method] = ((...args: unknown[]) => {
			if (shouldQuiet(args)) return;
			original(...args);
		}) as (typeof console)[ConsoleMethod];
	}
	try {
		return await fn();
	} finally {
		for (const method of METHODS) {
			const original = originals.get(method);
			if (original) console[method] = original as (typeof console)[ConsoleMethod];
		}
	}
}
