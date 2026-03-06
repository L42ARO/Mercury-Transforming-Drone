import { createTheme, rem } from '@mantine/core';

export const theme = createTheme({
  fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
  primaryShade: { light: 6, dark: 5 },
  primaryColor: 'brand',
  colors: {
    // 10-step Mantine palette for "brand" (start → end of gradient)
    brand: [
      '#ffe8e9', // 0
      '#ffd1d4', // 1
      '#ffb3b7', // 2
      '#ff959a', // 3
      '#ff7a81', // 4
      '#ee636e', // 5  <-- your start color
      '#ff7f6a', // 6
      '#ff9561', // 7
      '#ffa458', // 8
      '#ff9d5b', // 9  <-- your end color
    ],
    // solid black utility palette
    ink: ['#000000','#000000','#000000','#000000','#000000',
          '#000000','#000000','#000000','#000000','#000000'],
  },
  defaultRadius: 'lg',
  components: {
    Button: {
      styles: {
        root: {
          fontWeight: 600,
        },
      },
      defaultProps: {
        variant: 'gradient',
        gradient: { from: '#ee636e', to: '#ff9d5b', deg: 45 },
        size: 'md',
      },
    },
    TextInput: {
      defaultProps: {
        size: 'md',
        radius: 'md',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'xl',
        withBorder: true,
        p: 'xl',
      },
    },
    Container: {
      defaultProps: {
        size: 'sm',
      },
    },
  },
  headings: {
    sizes: {
      h1: { fontSize: rem(34), fontWeight: '800' },
    },
  },
});
