declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.svg?react' {
  import * as React from 'react';
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.scss' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '*CHANGELOG.md' {
  export type ChangelogEntry = { date: string; html: string };
  export const entries: ChangelogEntry[];
  const _default: ChangelogEntry[];
  export default _default;
}
