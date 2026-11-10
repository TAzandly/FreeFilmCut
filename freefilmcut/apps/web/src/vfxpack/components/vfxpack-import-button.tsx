"use client";

import { Button } from "@/components/ui/button";
import { useFileUpload } from "@/media/use-file-upload";
import { importVfxPackFiles } from "@/vfxpack/import-vfxpack-files";
import type { PrimaryVfxPackType } from "@/vfxpack/types";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudUploadIcon } from "@hugeicons/core-free-icons";

export function VfxPackImportButton({
	expectTypes,
	label = "Import VfxPack",
	size = "sm",
}: {
	expectTypes?: PrimaryVfxPackType[] | null;
	label?: string;
	size?: "sm" | "default";
}) {
	const { openFilePicker, fileInputProps } = useFileUpload({
		accept: ".vfxpack,application/zip",
		multiple: true,
		onFilesSelected: (files) => {
			void importVfxPackFiles({ files, expectTypes });
		},
	});

	return (
		<>
			<input {...fileInputProps} accept=".vfxpack,application/zip" />
			<Button variant="secondary" size={size} onClick={openFilePicker}>
				<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
				{label}
			</Button>
		</>
	);
}
