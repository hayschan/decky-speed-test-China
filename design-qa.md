# Design QA

## Comparison target

- Source visual truth: `/Users/hayschan/GitHub/decky-speed-test/assets/screenshot.jpg`
- Implementation screenshot: unavailable; this repository renders inside Steam Game Mode through Decky and the current macOS workspace does not provide that runtime.
- Source pixels: 1280 × 800 at 1× density.
- Source content region: Steam Quick Access panel, approximately 425 px wide.
- Intended implementation viewport: Steam Deck 1280 × 800, Quick Access panel.
- State: completed single-node result, dark Steam theme.

## Full-view comparison evidence

The source screenshot was opened and inspected. The implementation could not be rendered in the same Steam/Decky viewport, so a valid same-state screenshot comparison is not available.

Code-level continuity that was verified:

- The two-column download/upload and latency/jitter hierarchy is preserved.
- Metric labels remain 12 px muted text; primary values remain 28 px bold text with 14 px muted units.
- Download retains the orange `#f5a623` treatment and upload retains the purple `#9b59b6` treatment.
- The 60 px charts, 90th-percentile guide, loaded-latency subrows, compact panel spacing, and dark-theme balance are preserved.
- New settings use Decky-native `DropdownItem` and `ToggleField` controls.
- New primary navigation and history cards use Decky-native focusable buttons for gamepad navigation.

## Focused-region comparison evidence

A focused pixel comparison was not possible because the implementation screenshot is unavailable. The metric grid was checked directly against the source implementation values and layout; the new settings and history screens have no supplied screenshot reference and were checked against Decky component patterns.

## Findings

- [P1] Device-level rendering remains unverified.
  - Location: all three plugin views in Steam Game Mode.
  - Evidence: the source screenshot is available, but this workspace cannot launch the Decky Quick Access runtime.
  - Impact: Steam CSS overrides, focus rings, dropdown menus, Chinese text wrapping, and actual scroll height cannot be confirmed from a browser substitute.
  - Fix: install the built plugin on a Steam Deck or Linux Steam Game Mode environment, capture the test/settings/history views at 1280 × 800, and compare them against the source.

## Required fidelity surfaces

- Fonts and typography: source sizes, weights, labels, and unit hierarchy are preserved in code; runtime font rendering is unverified.
- Spacing and layout rhythm: source metric layout and chart dimensions are preserved; Steam runtime spacing is unverified.
- Colors and visual tokens: source muted, orange, purple, and Steam-blue colors are preserved.
- Image quality and asset fidelity: no new raster assets were introduced; the existing plugin icon and data charts remain code-rendered.
- Copy and content: all Cloudflare-specific UI copy was replaced with university node, protocol, multi-node average, and history language.

## Comparison history

- Initial pass: blocked because no Steam Game Mode / Decky renderer is available in the current workspace.
- Fixes made: none; there is no valid implementation capture to judge.
- Post-fix evidence: not available.

## Verification performed

- Frontend production build passed.
- Python backend compilation passed.
- Five backend unit tests passed.
- IPv4/automatic latency probes passed against all three university nodes.
- Minimum download and upload samples passed against all three university nodes.
- IPv6 latency probes passed against the USTC and NJU IPv6 hostnames.
- Browser-rendered implementation screenshot: unavailable.
- Primary interactions in Decky: not executable in this workspace.
- Steam browser console errors: not available.

final result: blocked
