import { useEffect, useRef, useState } from "react";

/**
 * Controlled text that stays IME- and caret-safe while focused.
 *
 * Writing every `onChange` into a parent store and rebinding `value={store}`
 * mid-composition commits Pinyin intermediates and jumps the caret to the end
 * on delete/insert. This hook keeps a local draft while focused, skips parent
 * writes during composition, and only mirrors external `value` when blurred.
 */
export function useImeSafeText({
	value,
	onChange,
	onBlurCommit,
}: {
	value: string;
	onChange: (next: string) => void;
	onBlurCommit?: () => void;
}) {
	const [draft, setDraft] = useState(value);
	const focusedRef = useRef(false);
	const composingRef = useRef(false);

	useEffect(() => {
		if (!focusedRef.current && !composingRef.current) {
			setDraft(value);
		}
	}, [value]);

	return {
		value: draft,
		onFocus: () => {
			focusedRef.current = true;
			setDraft(value);
		},
		onCompositionStart: () => {
			composingRef.current = true;
		},
		onCompositionEnd: (
			event: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>,
		) => {
			composingRef.current = false;
			const next = event.currentTarget.value;
			setDraft(next);
			onChange(next);
		},
		onChange: (
			event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
		) => {
			const next = event.currentTarget.value;
			setDraft(next);
			if (!composingRef.current) {
				onChange(next);
			}
		},
		onBlur: () => {
			focusedRef.current = false;
			composingRef.current = false;
			onBlurCommit?.();
		},
	};
}
