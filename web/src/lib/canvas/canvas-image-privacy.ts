import { cloneElement, type CSSProperties, type ReactElement } from "react";

export const canvasImagePrivacyStyle: CSSProperties = { filter: "blur(32px)" };

export function renderCanvasImagePreview(image: ReactElement, privacyBlurred?: boolean) {
    if (!privacyBlurred) return image;
    const original = image as ReactElement<{ style?: CSSProperties }>;
    return cloneElement(original, { style: { ...original.props.style, ...canvasImagePrivacyStyle } });
}
