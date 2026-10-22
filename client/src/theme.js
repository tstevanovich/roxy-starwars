import { createTheme } from '@mui/material/styles';

const headingFont = '"Segoe UI", system-ui, sans-serif';

export const theme = createTheme({
  palette: {
    primary: { main: '#415d3b', contrastText: '#fff' },
    secondary: { main: '#ddc98f', light: '#f3eddb', contrastText: '#293526' },
    background: { default: '#f5f5ee', paper: '#fffefa' },
    text: { primary: '#293528', secondary: '#6c7565' },
    divider: '#dfe4d9',
    error: { main: '#8e5048' }
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    h1: {
      fontFamily: headingFont,
      fontSize: 'clamp(1.8rem, 3vw, 2.4rem)',
      fontWeight: 600,
      lineHeight: 1.14,
      letterSpacing: '-0.045em'
    },
    h2: {
      fontFamily: headingFont,
      fontSize: '1.45rem',
      fontWeight: 600,
      letterSpacing: '-0.03em'
    },
    h3: { fontFamily: headingFont, fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontFamily: headingFont, fontWeight: 600 },
    overline: { fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.15em' },
    button: { textTransform: 'none', fontWeight: 600 }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { minWidth: 320 },
        ':focus-visible': { outline: '3px solid #668b40', outlineOffset: 4 }
      }
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 44, borderRadius: 9 } }
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { backgroundColor: '#fafbf8', borderRadius: 9 } }
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } }
  }
});
