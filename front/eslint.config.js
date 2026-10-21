import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Declarative views retain a size guard without splitting markup into artificial layers.
    files: ["src/**/*.tsx"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 180, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
