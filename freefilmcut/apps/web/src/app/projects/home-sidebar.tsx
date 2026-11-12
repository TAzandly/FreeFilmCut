"use client";

import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Layout01Icon,
	ScissorIcon,
	UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { FaGithub } from "react-icons/fa6";
import { toast } from "sonner";
import { DEFAULT_LOGO_URL } from "@/site/brand";
import { SOCIAL_LINKS } from "@/site/social";
import { cn } from "@/utils/ui";

export type HomeSection = "home" | "templates";

interface HomeSidebarProps {
	activeSection: HomeSection;
	onSectionChange: (section: HomeSection) => void;
}

const NAV_ITEMS: {
	id: HomeSection;
	label: string;
	icon: typeof ScissorIcon;
}[] = [
	{ id: "home", label: "Home", icon: ScissorIcon },
	{ id: "templates", label: "Templates", icon: Layout01Icon },
];

export function HomeSidebar({
	activeSection,
	onSectionChange,
}: HomeSidebarProps) {
	const handleSignInClick = () => {
		toast.message("Sign in", {
			description:
				"Account sign-in UI is not wired in this build yet. You can keep editing projects locally.",
		});
	};

	return (
		<aside className="bg-card/40 border-border/60 flex w-[200px] shrink-0 flex-col border-r">
			<div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
				<Image
					src={DEFAULT_LOGO_URL}
					alt="FreeFilmCut"
					width={28}
					height={28}
					className="size-7 rounded-md object-cover"
				/>
				<span className="text-sm font-semibold tracking-tight">FreeFilmCut</span>
			</div>

			<button
				type="button"
				onClick={handleSignInClick}
				className={cn(
					"mx-3 mb-1.5 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
					"hover:bg-accent/60",
				)}
				aria-label="Sign in"
			>
				<div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
					<HugeiconsIcon icon={UserCircleIcon} className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">Click to sign in</p>
					<p className="text-muted-foreground truncate text-xs">Sign in</p>
				</div>
			</button>

			<a
				href={SOCIAL_LINKS.github}
				target="_blank"
				rel="noopener noreferrer"
				className={cn(
					"mx-3 mb-4 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
					"hover:bg-accent/60",
				)}
				aria-label="GitHub repository"
			>
				<div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
					<FaGithub className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">GitHub</p>
					<p className="text-muted-foreground truncate text-xs">View repository</p>
				</div>
			</a>

			<nav className="flex flex-col gap-1 px-3">
				{NAV_ITEMS.map((item) => {
					const isActive = activeSection === item.id;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => onSectionChange(item.id)}
							className={cn(
								"flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
								isActive
									? "bg-accent text-foreground font-medium"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
							aria-current={isActive ? "page" : undefined}
						>
							<HugeiconsIcon icon={item.icon} className="size-5" />
							{item.label}
						</button>
					);
				})}
			</nav>

			<div className="text-muted-foreground mt-auto px-4 py-4 text-xs leading-relaxed">
				Local projects stay on this device.
			</div>
		</aside>
	);
}

export function TemplatesPanel() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-20 text-center">
			<div className="bg-muted/40 flex size-14 items-center justify-center rounded-2xl">
				<HugeiconsIcon
					icon={Layout01Icon}
					className="text-muted-foreground size-7"
				/>
			</div>
			<h2 className="text-lg font-medium">Templates</h2>
			<p className="text-muted-foreground max-w-md text-sm">
				Project templates are not available here yet. Open a project and use
				editor text / sticker templates from the media panel.
			</p>
		</div>
	);
}

export function StartCreatingCta({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"group relative flex w-full items-center justify-center overflow-hidden rounded-2xl",
				"min-h-[112px] px-6 py-8",
				"bg-gradient-to-r from-teal-700/90 via-violet-700/80 to-fuchsia-700/70",
				"text-white shadow-lg transition hover:brightness-110",
			)}
		>
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
			<div className="relative flex flex-col items-center gap-2">
				<div className="flex size-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
					<span className="text-3xl font-light leading-none">+</span>
				</div>
				<span className="text-xl font-semibold tracking-tight">Start creating</span>
				<span className="text-sm text-white/80">New project</span>
			</div>
		</button>
	);
}