import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".agents/skills/impeccable/**",
      ".github/skills/impeccable/**",
      ".impeccable/**",
      "coverage/**",
      "dist/**",
      "out/**",
      "playwright-report/**",
      "reports/**",
      "test-results/**",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/app/**"],
          allowTypeImports: true,
          message: "Renderer runtime code belongs in shared/domain modules; application services run in Electron main."
        }]
      }],
      "no-restricted-syntax": ["error", {
        selector: "ImportExpression[source.value=/app\\u002F/]",
        message: "Do not dynamically load application services in the renderer."
      }]
    }
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/app/**", "**/electron/**", "electron", "node:*", "fs", "fs/**", "path", "sqlite"],
          message: "Shared contracts and composition must not depend on application services or desktop runtime."
        }]
      }]
    }
  },
  {
    files: ["tests/**/*.ts", "vitest.*.config.ts"],
    plugins: {
      vitest
    },
    rules: {
      ...vitest.configs.recommended.rules
    }
  }
);
