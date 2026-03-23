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
  hasAuth?: boolean;
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

export interface BuildManifest {
  routes: ManifestRoute[];
  apiRoutes: ManifestRoute[];
  layouts: ManifestLayout[];
  i18n?: I18nManifest;
  auth?: { configModule: string };
  prefetch: 'hover' | 'viewport' | 'none';
}
