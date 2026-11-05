import { ThemeProvider } from "next-themes";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData } from "./metadata";
import { BotIdClient } from "botid/client";
import { webEnv } from "@/env/web";
import { Inter } from "next/font/google";
import { FccLightFps } from "@/components/fcc-light-fps";

const siteFont = Inter({ subsets: ["latin"] });

export const metadata = baseMetaData;

const protectedRoutes = [
	{
		path: "/none",
		method: "GET",
	},
];

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	// Browser translate wraps text in <font> and breaks React removeChild — disable for the NLE UI.
	return (
		<html lang="en" translate="no" className="notranslate" suppressHydrationWarning>
			<head>
				<BotIdClient protect={protectedRoutes} />
				{/* fcc-tl-flower-67b: lightweight FPS meter (bottom-left via FccLightFps) (rAF counter only — does not tank FPS).
				    Toggle: Settings → Developer → Performance overlay (per browser, no reload).
				    Legacy keys still honoured on first load: localStorage.setItem('fccFps','0')
				    react-scan FPS Drop UI is SEPARATE and costly — opt-in only:
				    localStorage.setItem('fccReactScan','1'); location.reload()
				    Off: localStorage.removeItem('fccReactScan'); location.reload() */}
				{process.env.NODE_ENV === "development" && (
					<>
<Script id="fcc-react-scan-opt-in" strategy="beforeInteractive">{`
							try {
								if (localStorage.getItem('fccReactScan') === '1') {
									var s = document.createElement('script');
									s.src = '//unpkg.com/react-scan/dist/auto.global.js';
									s.crossOrigin = 'anonymous';
									document.head.appendChild(s);
								}
							} catch (e) {}
						`}</Script>
					</>
				)}
			</head>
			<body className={`${siteFont.className} font-sans antialiased`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange={true}
				>
					<TooltipProvider>
						<Toaster />
						<FccLightFps />
						{webEnv.NODE_ENV !== "development" && (
							<Script
								src="https://cdn.databuddy.cc/databuddy.js"
								strategy="afterInteractive"
								async
								data-client-id="UP-Wcoy5arxFeK7oyjMMZ"
								data-track-attributes={false}
								data-track-errors={true}
								data-track-outgoing-links={false}
								data-track-web-vitals={false}
								data-track-sessions={false}
							/>
						)}
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}