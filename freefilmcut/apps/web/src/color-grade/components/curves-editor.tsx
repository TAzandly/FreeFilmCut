"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
	CURVE_CHANNELS,
	DEFAULT_CURVE_POINTS,
	type CurveChannel,
	type CurvePoint,
	parseCurvePoints,
	serializeCurvePoints,
} from "@/color-grade/curves";
import { cn } from "@/utils/ui";

const CHANNEL_LABEL: Record<CurveChannel, string> = {
	master: "Master",
	r: "Red",
	g: "Green",
	b: "Blue",
};

const CHANNEL_STROKE: Record<CurveChannel, string> = {
	master: "currentColor",
	r: "#ef4444",
	g: "#22c55e",
	b: "#3b82f6",
};

export function CurvesEditor({
	curves,
	onPreview,
	onCommit,
}: {
	curves: Record<CurveChannel, CurvePoint[]>;
	onPreview: (channel: CurveChannel, points: CurvePoint[]) => void;
	onCommit: () => void;
}) {
	const [channel, setChannel] = useState<CurveChannel>("master");
	const points = curves[channel] ?? DEFAULT_CURVE_POINTS;
	const svgRef = useRef<SVGSVGElement | null>(null);
	const dragIndex = useRef<number | null>(null);

	const pathD = useMemo(() => {
		if (points.length === 0) return "";
		return points
			.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${(1 - p.y) * 100}`)
			.join(" ");
	}, [points]);

	const clientToPoint = useCallback((clientX: number, clientY: number) => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		const rect = svg.getBoundingClientRect();
		const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const y = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
		return { x, y };
	}, []);

	const emitPoints = useCallback(
		(next: CurvePoint[], commit = false) => {
			const sorted = [...next].sort((a, b) => a.x - b.x);
			sorted[0] = { x: 0, y: sorted[0]?.y ?? 0 };
			sorted[sorted.length - 1] = {
				x: 1,
				y: sorted[sorted.length - 1]?.y ?? 1,
			};
			onPreview(channel, sorted);
			if (commit) onCommit();
		},
		[channel, onCommit, onPreview],
	);

	return (
		<div className="flex flex-col gap-3 px-3.5 pb-4">
			<div className="flex gap-1">
				{CURVE_CHANNELS.map((id) => (
					<button
						key={id}
						type="button"
						className={cn(
							"rounded px-2 py-1 text-xs",
							channel === id
								? "bg-secondary text-foreground"
								: "text-muted-foreground hover:bg-muted",
						)}
						onClick={() => setChannel(id)}
					>
						{CHANNEL_LABEL[id]}
					</button>
				))}
			</div>
			<svg
				ref={svgRef}
				viewBox="0 0 100 100"
				className="bg-muted/40 aspect-square w-full touch-none rounded-md border"
				onPointerDown={(event) => {
					const pt = clientToPoint(event.clientX, event.clientY);
					// Hit existing point or add
					let hit = points.findIndex(
						(p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 0.05,
					);
					let next = [...points];
					if (hit < 0) {
						next.push(pt);
						next.sort((a, b) => a.x - b.x);
						hit = next.findIndex(
							(p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 0.05,
						);
					}
					dragIndex.current = hit;
					(event.target as Element).setPointerCapture?.(event.pointerId);
					emitPoints(next);
				}}
				onPointerMove={(event) => {
					if (dragIndex.current === null) return;
					const pt = clientToPoint(event.clientX, event.clientY);
					const next = points.map((p, i) =>
						i === dragIndex.current ? { ...pt } : p,
					);
					emitPoints(next);
				}}
				onPointerUp={() => {
					dragIndex.current = null;
					onCommit();
				}}
			>
				<title>{CHANNEL_LABEL[channel]} curve</title>
				<line
					x1="0"
					y1="100"
					x2="100"
					y2="0"
					stroke="currentColor"
					strokeOpacity="0.15"
					strokeWidth="0.5"
				/>
				<path
					d={pathD}
					fill="none"
					stroke={CHANNEL_STROKE[channel]}
					strokeWidth="1.5"
				/>
				{points.map((p, i) => (
					<circle
						key={`${p.x}-${p.y}-${i}`}
						cx={p.x * 100}
						cy={(1 - p.y) * 100}
						r="2.2"
						fill={CHANNEL_STROKE[channel]}
					/>
				))}
			</svg>
			<button
				type="button"
				className="text-muted-foreground self-start text-xs underline"
				onClick={() => {
					onPreview(channel, [...DEFAULT_CURVE_POINTS]);
					onCommit();
				}}
			>
				Reset {CHANNEL_LABEL[channel]}
			</button>
		</div>
	);
}

export function curvesFromParamStrings({
	master,
	r,
	g,
	b,
}: {
	master?: string;
	r?: string;
	g?: string;
	b?: string;
}): Record<CurveChannel, CurvePoint[]> {
	return {
		master: parseCurvePoints(master ?? serializeCurvePoints(DEFAULT_CURVE_POINTS)),
		r: parseCurvePoints(r ?? serializeCurvePoints(DEFAULT_CURVE_POINTS)),
		g: parseCurvePoints(g ?? serializeCurvePoints(DEFAULT_CURVE_POINTS)),
		b: parseCurvePoints(b ?? serializeCurvePoints(DEFAULT_CURVE_POINTS)),
	};
}
