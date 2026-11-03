"use client";

import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { setDiagSettings, useDiagSettings } from "@/diagnostics/diag-settings";
import { Switch } from "@/components/ui/switch";

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Machine-local performance switches.
 *
 * Nothing here is persisted into the project file — these are diagnostics for
 * whoever is looking at this browser, not properties of the edit. That is also
 * why they live in a separate tab instead of next to the canvas settings: a
 * project setting is shared, a diag switch is not.
 */
export function DeveloperContent() {
	const settings = useDiagSettings();

	return (
		<div className="flex flex-col">
			<Section showTopBorder={false}>
				<SectionHeader className="justify-between">
					<SectionTitle className="flex-1">Performance overlay</SectionTitle>
					<Switch
						checked={settings.perfOverlay}
						onCheckedChange={(value) =>
							setDiagSettings({ patch: { perfOverlay: value } })
						}
						aria-label="Performance overlay"
					/>
				</SectionHeader>
				<SectionContent className="pt-0">
					<p className="text-xs text-muted-foreground">
						Bottom-left meter: FPS, real refresh period, dropped frames,
						per-frame compose cost and how many videos are decoding. Turning
						it off stops the sampling loop, it does not just hide the box.
					</p>
				</SectionContent>
			</Section>

			{IS_DEV && (
				<Section>
					<SectionHeader className="justify-between">
						<SectionTitle className="flex-1">Compose profiler</SectionTitle>
						<Switch
							checked={settings.renderProfiler}
							onCheckedChange={(value) =>
								setDiagSettings({ patch: { renderProfiler: value } })
							}
							aria-label="Compose profiler"
						/>
					</SectionHeader>
					<SectionContent className="pt-0">
						<p className="text-xs text-muted-foreground">
							Dumps per-stage timings every 60 frames — resolve, buildFrame,
							syncTextures, renderFrame, sorted by mean cost. This is what
							splits an over-budget compose into its parts. Same switch as{" "}
							<code className="text-[11px]">window.__renderPerf</code>, so the
							console still works for a one-off look.
						</p>
					</SectionContent>
				</Section>
			)}

			<Section showBottomBorder={false}>
				<SectionContent className="pt-4">
					<p className="text-xs text-muted-foreground">
						Stored per browser, not in the project. Takes effect immediately —
						no reload needed.
					</p>
				</SectionContent>
			</Section>
		</div>
	);
}
