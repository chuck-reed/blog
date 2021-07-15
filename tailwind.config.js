module.exports = {
  mode: "jit",
  purge: ["templates/**/*.html"],
  theme: {
    extend: {
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme("colors.gray.200"),
            a: {
              color: theme("colors.green.300"),
              "&:hover": {
                color: theme("colors.green.400"),
              },
              "&:visited": {
                color: theme("colors.green.400"),
              },
            },
            blockquote: {
              color: theme("colors.gray.200"),
              fontWeight: "600",
              fontStyle: "italic",
              borderLeftColor: theme("colors.gray.400"),
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
