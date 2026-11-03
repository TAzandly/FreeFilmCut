"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { StickerVfxPackSection } from "@/effects/components/assets-view";

export function StickersView() {
	const [searchQuery, setSearchQuery] = useState("");
	const query = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

	return (
		<div className="flex h-full flex-col py-2">
			<div className="px-2">
				<Input
					size="sm"
					variant="default"
					placeholder="Search stickers..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					showClearIcon
					onClear={() => setSearchQuery("")}
					className="w-full"
					containerClassName="w-full"
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pt-2">
				<StickerVfxPackSection searchQuery={query} />
			</div>
		</div>
	);
}
