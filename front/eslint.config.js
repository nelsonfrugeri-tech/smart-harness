import tseslint from "typescript-eslint";
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-dom",
            "../app/*",
            "../pages/*",
            "../components/*",
            "../data/*",
          ],
        },
      ],
    },
  },
);
