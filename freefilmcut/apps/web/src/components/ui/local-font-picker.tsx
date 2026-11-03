"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { List, type RowComponentProps } from "react-window";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { ChevronDown, Search } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TextIcon } from "@hugeicons/core-free-icons";
import {
	ensureLocalFontUrl,
	getLocalFontPermission,
	isLocalFontAccessSupported,
	requestLocalFonts,
	type LocalFontEntry,
	type LocalFontPermission,
} from "@/fonts/local-fonts";

const ROW_HEIGHT = 36;
const LIST_WIDTH = 288;
const MAX_LIST_HEIGHT = 288;
const OVERSCAN = 12;

interface LocalFontPickerProps {
	value?: string;
	onChange?: (family: string) => void;
	className?: string;
}

export function LocalFontPicker({
	value,
	onChange,
	className,
}: LocalFontPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [fonts, setFonts] = useState<LocalFontEntry[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
		"idle",
	);
	const [permission, setPermission] = useState<LocalFontPermission>(() =>
		getLocalFontPermission(),
	);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const loadCatalog = useCallback(async () => {
		if (!isLocalFontAccessSupported()) {
			setPermission("unsupported");
			setStatus("error");
			setFonts([]);
			return;
		}
		setStatus("loading");
		try {
			// force:true so a prior silent denial can recover on user click.
			const list = await requestLocalFonts({ force: true });
			setPermission(getLocalFontPermission());
			setFonts(list);
			setStatus(list.length > 0 ? "ready" : "error");
		} catch {
			setPermission(getLocalFontPermission());
			setStatus("error");
			setFonts([]);
		}
	}, []);

	useEffect(() => {
		if (!open) {
			setSearch("");
			return;
		}
		void loadCatalog();
	}, [open, loadCatalog]);

	const filtered = useMemo(() => {
		if (!search) return fonts;
		const q = search.toLowerCase();
		return fonts.filter(
			(f) =>
				f.family.toLowerCase().includes(q) ||
				f.fullName.toLowerCase().includes(q),
		);
	}, [fonts, search]);

	const listHeight = Math.min(MAX_LIST_HEIGHT, filtered.length * ROW_HEIGHT);

	const handleSelect = useCallback(
		async ({ family }: { family: string }) => {
			try {
				await ensureLocalFontUrl({ family });
			} catch {
				/* Troika will fall back to Noto until blob is ready */
			}
			onChange?.(family);
			setOpen(false);
		},
		[onChange],
	);

	const display = value?.trim() || "Select a font";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					"border-border bg-accent flex h-7 w-full cursor-pointer items-center justify-between gap-1 rounded-md border px-2.5 text-sm whitespace-nowrap focus-visible:border-primary focus-visible:ring-0 focus:outline-hidden",
					className,
				)}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-muted-foreground [&_svg]:size-3.5 shrink-0">
						<HugeiconsIcon icon={TextIcon} />
					</span>
					<span className="truncate" style={{ fontFamily: value || undefined }}>
						{display}
					</span>
				</div>
				<ChevronDown className="size-3 shrink-0 opacity-50" />
			</PopoverTrigger>
			<PopoverContent
				className="w-72 p-0 overflow-hidden"
				align="start"
				side="left"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					searchInputRef.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<div className="relative px-3 py-1.5">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 shrink-0 opacity-50" />
					<Input
						ref={searchInputRef}
						placeholder="Search system fonts..."
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						size="xs"
						className="w-full pl-5 bg-transparent border-none! shadow-none!"
					/>
				</div>
				{status === "loading" && (
					<div className="py-8 text-center text-sm text-muted-foreground">
						Loading system fonts...
					</div>
				)}
				{status === "error" && (
					<div className="flex flex-col items-center gap-3 py-8 px-4">
						<p className="text-sm text-muted-foreground text-center">
							{permission === "unsupported"
								? "This browser does not support local fonts. Using bundled Noto."
								: permission === "denied"
									? "Font access blocked. Click Retry and Allow, or enable Local fonts for this site in browser settings."
									: "No system fonts available."}
						</p>
						{permission !== "unsupported" && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => void loadCatalog()}
							>
								Retry
							</Button>
						)}
					</div>
				)}
				{status === "ready" && filtered.length === 0 && (
					<div className="py-6 text-center text-sm text-muted-foreground">
						No fonts found.
					</div>
				)}
				{status === "ready" && filtered.length > 0 && (
					<List
						rowCount={filtered.length}
						rowHeight={ROW_HEIGHT}
						overscanCount={OVERSCAN}
						rowComponent={LocalFontRow}
						rowProps={{
							fonts: filtered,
							selected: value,
							onSelect: handleSelect,
						}}
						style={{ height: listHeight, width: LIST_WIDTH }}
					/>
				)}
			</PopoverContent>
		</Popover>
	);
}

type LocalFontRowProps = {
	fonts: LocalFontEntry[];
	selected: string | undefined;
	onSelect: (params: { family: string }) => void;
};

function LocalFontRow({
	index,
	style,
	fonts,
	selected,
	onSelect,
}: RowComponentProps<LocalFontRowProps>) {
	const font = fonts[index];
	if (!font) return null;
	const isSelected = font.family === selected;

	return (
		<button
			type="button"
			style={style as CSSProperties}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 px-3 outline-hidden hover:bg-popover-hover",
				isSelected && "bg-popover-hover",
			)}
			onClick={() => onSelect({ family: font.family })}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect({ family: font.family });
				}
			}}
			aria-label={font.family}
		>
			<span
				className="truncate text-sm text-foreground/90"
				style={{ fontFamily: `"${font.family.replace(/"/g, "")}"` }}
			>
				{font.family}
			</span>
		</button>
	);
}
