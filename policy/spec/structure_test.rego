package main

import rego.v1

# ---------------------------------------------------------------------------
# Helpers to build minimal remark AST nodes
# ---------------------------------------------------------------------------

h(depth, text) := {"type": "heading", "depth": depth, "children": [{"type": "text", "value": text}]}

tbl(cols) := {"type": "table", "children": [{"type": "tableRow", "children": [{"type": "tableCell"} | some _ in numbers.range(1, cols)]}]}

doc(children) := {"type": "root", "children": children}

feature_doc(children) := {"type": "root", "children": children, "metadata": {"is_feature": true}}

doc_with_name(filename, children) := {"type": "root", "children": children, "metadata": {"filename": filename}}

# ---------------------------------------------------------------------------
# Rule 1: H1 title pattern
# ---------------------------------------------------------------------------

test_h1_valid_en if {
	count(deny) == 0 with input as doc([h(1, "Oksskolten Spec — Chat")])
}

test_h1_invalid if {
	"H1 must match 'Oksskolten Spec — {Feature}', got: 'Bad Title'" in deny with input as doc([h(1, "Bad Title")])
}

test_h1_ja_rejected if {
	"H1 must match 'Oksskolten Spec — {Feature}', got: 'Oksskolten 実装仕様書 — チャット'" in deny with input as doc([h(1, "Oksskolten 実装仕様書 — チャット")])
}

test_h1_missing if {
	"Spec must have exactly one H1, found 0" in deny with input as doc([h(2, "Only H2")])
}

test_h1_multiple if {
	"Spec must have exactly one H1, found 2" in deny with input as doc([
		h(1, "Oksskolten Spec — A"),
		h(1, "Oksskolten Spec — B"),
	])
}

# ---------------------------------------------------------------------------
# Rule 3: Forbidden section names
# ---------------------------------------------------------------------------

test_forbidden_current_status if {
	"Forbidden section name: 'Current Status'" in deny with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Current Status"),
	])
}

test_forbidden_implementation_checklist if {
	"Forbidden section name: 'Implementation Checklist'" in deny with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Implementation Checklist"),
	])
}

test_forbidden_reference_prefix if {
	"Forbidden section name: 'Reference: Keyboard Shortcuts'" in deny with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Reference: Keyboard Shortcuts"),
	])
}

test_allowed_section_name if {
	count(deny) == 0 with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Key Files"),
	])
}

# ---------------------------------------------------------------------------
# Rule 4: Key Files table columns
# ---------------------------------------------------------------------------

test_key_files_2_columns_pass if {
	count(deny) == 0 with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Key Files"),
		tbl(2),
	])
}

test_key_files_3_columns_fail if {
	"Key Files table must have 2 columns (File | Description), found 3" in deny with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(3, "Key Files"),
		tbl(3),
	])
}

# ---------------------------------------------------------------------------
# Rule 5: Max heading depth
# ---------------------------------------------------------------------------

test_h4_allowed if {
	count(deny) == 0 with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(4, "Subsection"),
	])
}

test_h5_denied if {
	"Heading depth 5 exceeds maximum (H4): 'Too Deep'" in deny with input as doc([
		h(1, "Oksskolten Spec — X"),
		h(5, "Too Deep"),
	])
}

# ---------------------------------------------------------------------------
# Rule 6: Back to Overview blockquote after H1
# ---------------------------------------------------------------------------

back_to_overview := {
	"type": "blockquote",
	"children": [{
		"type": "paragraph",
		"children": [{
			"type": "link",
			"url": "./01_overview.md",
			"children": [{"type": "text", "value": "Back to Overview"}],
		}],
	}],
}

back_to_overview_lowercase := {
	"type": "blockquote",
	"children": [{
		"type": "paragraph",
		"children": [{
			"type": "link",
			"url": "./01_overview.md",
			"children": [{"type": "text", "value": "Back to overview"}],
		}],
	}],
}

test_back_to_overview_pass if {
	count(deny) == 0 with input as doc_with_name("10_schema.md", [
		h(1, "Oksskolten Spec — SQLite Schema"),
		back_to_overview,
	])
}

test_back_to_overview_missing if {
	"Non-overview spec must have '> [Back to Overview](./01_overview.md)' immediately after H1" in deny with input as doc_with_name("10_schema.md", [
		h(1, "Oksskolten Spec — SQLite Schema"),
		h(2, "Schema"),
	])
}

test_back_to_overview_lowercase_rejected if {
	"Non-overview spec must have '> [Back to Overview](./01_overview.md)' immediately after H1" in deny with input as doc_with_name("80_feature_clip.md", [
		h(1, "Oksskolten Spec — Clip"),
		back_to_overview_lowercase,
	])
}

test_back_to_overview_skipped_for_overview if {
	count(deny) == 0 with input as doc_with_name("01_overview.md", [
		h(1, "Oksskolten Spec — Overview"),
		h(2, "Tech Stack"),
	])
}

# ---------------------------------------------------------------------------
# Rule 7: Overview must link to all spec files
# ---------------------------------------------------------------------------

link(url) := {"type": "paragraph", "children": [{"type": "link", "url": url, "children": [{"type": "text", "value": "link"}]}]}

overview_doc(all, children) := {"type": "root", "children": children, "metadata": {"filename": "01_overview.md", "all_filenames": all}}

test_overview_links_all_pass if {
	count(deny) == 0 with input as overview_doc(
		["01_overview.md", "10_schema.md", "20_api.md"],
		[
			h(1, "Oksskolten Spec — Overview"),
			link("./10_schema.md"),
			link("./20_api.md"),
		],
	)
}

test_overview_links_missing if {
	"01_overview.md must link to all spec files, missing: '20_api.md'" in deny with input as overview_doc(
		["01_overview.md", "10_schema.md", "20_api.md"],
		[
			h(1, "Oksskolten Spec — Overview"),
			link("./10_schema.md"),
		],
	)
}

test_overview_links_skips_self if {
	count(deny) == 0 with input as overview_doc(
		["01_overview.md"],
		[h(1, "Oksskolten Spec — Overview")],
	)
}

# ---------------------------------------------------------------------------
# Rule 8: Feature spec H2 structure
# ---------------------------------------------------------------------------

# 8a: All required H2s present (Overview, Motivation, Design)
test_feature_h2_all_required_pass if {
	count(deny) == 0 with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Motivation"),
		h(2, "Design"),
	])
}

test_feature_h2_missing_overview if {
	"Feature spec must have '## Overview' section" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Motivation"),
		h(2, "Design"),
	])
}

test_feature_h2_missing_motivation if {
	"Feature spec must have '## Motivation' section" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Design"),
	])
}

test_feature_h2_missing_design if {
	"Feature spec must have '## Design' section" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Motivation"),
	])
}

# 8b: Disallowed H2
test_feature_h2_disallowed if {
	"Feature spec H2 must be one of {Overview, Scope, Motivation, Design}, got: '## API'" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Motivation"),
		h(2, "Design"),
		h(2, "API"),
	])
}

# Feature-name H2 is also disallowed (redundant with H1)
test_feature_h2_feature_name_disallowed if {
	"Feature spec H2 must be one of {Overview, Scope, Motivation, Design}, got: '## Clip'" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Clip"),
		h(2, "Overview"),
		h(2, "Motivation"),
		h(2, "Design"),
	])
}

# H3 under Design is fine
test_feature_h3_under_design_ok if {
	count(deny) == 0 with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Motivation"),
		h(2, "Design"),
		h(3, "API"),
		h(3, "Frontend"),
		h(3, "DB Schema"),
	])
}

# 8c: Wrong order
test_feature_h2_wrong_order if {
	"Feature spec H2 order must be: Overview → Motivation → (Scope) → Design" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Design"),
		h(2, "Overview"),
		h(2, "Motivation"),
	])
}

# Optional Scope in correct position
test_feature_h2_with_scope_pass if {
	count(deny) == 0 with input as feature_doc([
		h(1, "Oksskolten Spec — Keyboard Navigation"),
		h(2, "Overview"),
		h(2, "Motivation"),
		h(2, "Scope"),
		h(2, "Design"),
	])
}

# 8d: Scope in wrong position (before Motivation)
test_feature_h2_scope_wrong_position if {
	"Feature spec '## Scope' must appear between Motivation and Design" in deny with input as feature_doc([
		h(1, "Oksskolten Spec — Clip"),
		h(2, "Overview"),
		h(2, "Scope"),
		h(2, "Motivation"),
		h(2, "Design"),
	])
}

# Non-feature specs are not affected
test_non_feature_free_h2 if {
	count(deny) == 0 with input as doc([
		h(1, "Oksskolten Spec — API"),
		h(2, "API Specification"),
		h(3, "Endpoints"),
		h(3, "Error Handling"),
	])
}
