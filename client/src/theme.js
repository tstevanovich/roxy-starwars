import { createTheme } from '@mui/material/styles';

const headingFont = 'Manrope, system-ui, sans-serif';

export const theme = createTheme({
  palette: {
    primary: { main: '#204b3f', contrastText: '#fff' },
    secondary: { main: '#78906a', light: '#f3f6ee' },
    background: { default: '#f6f7f2', paper: '#fff' },
    text: { primary: '#17342f', secondary: '#67746d' },
    divider: '#dfe4d9',
    error: { main: '#8e5048' }
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    h1: {
      fontFamily: headingFont,
      fontSize: 'clamp(2.4rem, 5.5vw, 3.75rem)',
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
