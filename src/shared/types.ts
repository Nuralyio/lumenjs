export interface ManifestLayout {
  dir: string;
  module: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
}

export interface ManifestRoute {
  path: string;
  module: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
  hasSocket?: boolean;
  hasAuth?: boolean;
  hasMeta?: boolean;
  authRoles?: string[];
  hasStandalone?: boolean;
  tagName?: string;
  layouts?: string[];
  prerender?: boolean;
}

export interface I18nManifest {
  locales: string[];
  defaultLocale: string;
  prefixDefault: boolean;
}

export interface ManifestMiddleware {
  dir: string;
  module: string;
}

export interface ManifestComponent {
  file: string;
  module: string;
  tagName: string;
}

export interface BuildManifest {
  routes: ManifestRoute[];
  apiRoutes: ManifestRoute[];
  layouts: ManifestLayout[];
  components?: ManifestComponent[];
  middlewares?: ManifestMiddleware[];
  i18n?: I18nManifest;
  auth?: { configModule: string };
  prefetch: 'hover' | 'viewport' | 'none';
}
