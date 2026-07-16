import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ComposeModal from "./ComposeModal";

const renderCompose = () => renderToStaticMarkup(createElement(ComposeModal, {
  isOpen: true,
  onClose: vi.fn(),
  onSend: vi.fn(),
  onSendFailure: vi.fn(),
  composeContext: null,
  onDraftSaved: vi.fn(),
}));

describe("ComposeModal layout", () => {
  it("renders as a plain compose workspace instead of a nested glass card", () => {
    const markup = renderCompose();

    expect(markup).toContain('class="compose-modal"');
    expect(markup).not.toContain('class="compose-modal glass-container"');
  });

  it("keeps the attachment picker in the fixed footer after the scrolling body", () => {
    const markup = renderCompose();
    const bodyIndex = markup.indexOf('class="compose-modal__body"');
    const footerIndex = markup.indexOf('class="compose-modal__footer"');
    const attachmentButtonIndex = markup.indexOf(
      'class="compose-modal__attach-files-button"',
    );

    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(bodyIndex);
    expect(attachmentButtonIndex).toBeGreaterThan(footerIndex);
  });

  it("renders To, then Subject, then Advanced toggle, then Message", () => {
    const markup = renderCompose();
    const toIndex = markup.indexOf('id="to"');
    const subjectIndex = markup.indexOf('id="subject"');
    const advancedIndex = markup.indexOf(
      'class="compose-modal__advanced-toggle"',
    );
    const bodyIndex = markup.indexOf('id="body"');

    expect(toIndex).toBeGreaterThanOrEqual(0);
    expect(subjectIndex).toBeGreaterThan(toIndex);
    expect(advancedIndex).toBeGreaterThan(subjectIndex);
    expect(bodyIndex).toBeGreaterThan(advancedIndex);
  });
});
