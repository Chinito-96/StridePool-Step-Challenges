/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#1D2435',
    tint: '#DE5E45',

    // Core surfaces
    background: '#F7F3EC',
    foreground: '#1D2435',

    // Cards / elevated surfaces
    card: '#FCFAF6',
    cardForeground: '#1D2435',

    // Primary action color (buttons, links, active states)
    primary: '#DE5E45',
    primaryForeground: '#FCFAF6',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#C8E4E3',
    secondaryForeground: '#274948',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ECE7DD',
    mutedForeground: '#6A6E7C',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#B9DE49',
    accentForeground: '#33391C',

    // Destructive actions (delete, error states)
    destructive: '#C8423B',
    destructiveForeground: '#FCFAF6',

    // Borders and input outlines
    border: '#DED8CC',
    input: '#DED8CC',
  },
  dark: {
    text: '#F7F3EC',
    tint: '#DE5E45',
    background: '#1D2435',
    foreground: '#F7F3EC',
    card: '#252D40',
    cardForeground: '#F7F3EC',
    primary: '#DE5E45',
    primaryForeground: '#FCFAF6',
    secondary: '#365958',
    secondaryForeground: '#F7F3EC',
    muted: '#30384B',
    mutedForeground: '#A8ADBA',
    accent: '#B9DE49',
    accentForeground: '#33391C',
    destructive: '#D84F48',
    destructiveForeground: '#FCFAF6',
    border: '#3A4357',
    input: '#3A4357',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 14,
};

export default colors;
