"use client";

import { useEffect, useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { useLocalStorage } from "@/services/storage/use-local-storage";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "../ui/dialog";

const DONT_SHOW_KEY = "onboardingDontShowAgain";
const LEGACY_SEEN_KEY = "hasSeenOnboarding";

export function Onboarding() {
	const [dontShowAgain, setDontShowAgain, isReady] = useLocalStorage({
		key: DONT_SHOW_KEY,
		defaultValue: false,
	});
	const [dontShowChecked, setDontShowChecked] = useState(false);
	const [dismissedThisSession, setDismissedThisSession] = useState(false);
	const [legacyMigrated, setLegacyMigrated] = useState(false);

	// One-time: previous Finish (hasSeenOnboarding) → treat as "don't show again"
	useEffect(() => {
		if (!isReady) return;
		try {
			const legacy = localStorage.getItem(LEGACY_SEEN_KEY);
			const already = localStorage.getItem(DONT_SHOW_KEY);
			if (legacy === "true" && already === null) {
				setDontShowAgain({ value: true });
				localStorage.removeItem(LEGACY_SEEN_KEY);
			}
		} catch {
			/* ignore */
		}
		setLegacyMigrated(true);
	}, [isReady, setDontShowAgain]);

	const isOpen =
		isReady && legacyMigrated && !dontShowAgain && !dismissedThisSession;

	const dismiss = ({ persist }: { persist: boolean }) => {
		if (persist) {
			setDontShowAgain({ value: true });
			try {
				localStorage.removeItem(LEGACY_SEEN_KEY);
			} catch {
				/* ignore */
			}
		}
		setDismissedThisSession(true);
	};

	const handleFinish = () => {
		dismiss({ persist: dontShowChecked });
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			dismiss({ persist: dontShowChecked });
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogTitle>
					<span className="sr-only">Welcome to FreeFilmCut Beta!</span>
				</DialogTitle>
				<DialogBody>
					<div className="space-y-5">
						<div className="space-y-3">
							<h2 className="text-lg font-bold md:text-xl">
								Welcome to FreeFilmCut Beta!
							</h2>
							<p className="text-muted-foreground mb-0">
								You're among the first to try FreeFilmCut - the fully open
								source CapCut alternative.
							</p>
						</div>
						<label className="flex cursor-pointer items-center gap-2">
							<Checkbox
								checked={dontShowChecked}
								onCheckedChange={(checked) =>
									setDontShowChecked(checked === true)
								}
								id="onboarding-dont-show"
							/>
							<Label
								htmlFor="onboarding-dont-show"
								className="cursor-pointer text-sm font-normal text-muted-foreground"
							>
								Don&apos;t show again
							</Label>
						</label>
						<Button
							onClick={handleFinish}
							variant="default"
							className="w-full"
						>
							Finish
							<ArrowRightIcon className="size-4" />
						</Button>
					</div>
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
