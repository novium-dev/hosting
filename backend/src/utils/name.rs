pub const DISPLAY_NAME_MAX_LENGTH: usize = 64;

const INVISIBLE: &[char] = &[
    '\u{00AD}', '\u{034F}', '\u{061C}', '\u{115F}', '\u{1160}', '\u{17B4}', '\u{17B5}', '\u{180E}',
    '\u{2800}', '\u{3164}', '\u{FEFF}', '\u{FFA0}',
];

fn is_blank(character: char) -> bool {
    character.is_whitespace()
        || character.is_control()
        || INVISIBLE.contains(&character)
        || matches!(
            character,
            '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FE00}'..='\u{FE0F}'
        )
}

#[must_use]
pub fn display_name(value: &str) -> Option<String> {
    let trimmed = value.trim_matches(is_blank);

    let valid = !trimmed.is_empty()
        && trimmed.chars().count() <= DISPLAY_NAME_MAX_LENGTH
        && !trimmed.chars().any(char::is_control);

    valid.then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_names() {
        for value in [
            "",
            "   ",
            "\t\n",
            "\u{200B}",
            " \u{3164} ",
            "\u{FEFF}\u{2060}",
        ] {
            assert_eq!(display_name(value), None, "{value:?}");
        }
    }

    #[test]
    fn trims_and_keeps_visible_names() {
        assert_eq!(display_name("  Lobby ").as_deref(), Some("Lobby"));
        assert_eq!(
            display_name("\u{200B}SucukCore").as_deref(),
            Some("SucukCore")
        );
        assert_eq!(display_name("a b").as_deref(), Some("a b"));
    }

    #[test]
    fn rejects_long_and_control_names() {
        assert_eq!(display_name(&"x".repeat(DISPLAY_NAME_MAX_LENGTH + 1)), None);
        assert!(display_name(&"x".repeat(DISPLAY_NAME_MAX_LENGTH)).is_some());
        assert_eq!(display_name("a\u{0007}b"), None);
    }
}
