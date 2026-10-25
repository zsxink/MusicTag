# Update notification indicator

## MODIFIED Requirements

### Requirement: Compact update indicator in the global app bar
When an available update is eligible to be shown, the global app bar MUST display a small red dot rather than a large circular badge. The dot MUST remain discoverable to assistive technology and retain the existing click action that restores the update notice. Its hover hint MUST remain available.

#### Scenario: Available update is indicated compactly
- **WHEN** an update is available and its notice can be restored
- **THEN** the app bar displays a small red dot beside the brand
- **AND** the dot does not render a text glyph or a large circular button surface
- **AND** it preserves the existing accessible name, hover hint, and restore action

#### Scenario: No available update
- **WHEN** no update is available
- **THEN** the dot is not rendered
