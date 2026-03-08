export interface ManifestLayout {
  dir: string;
  module: string;
  hasLoader: boolean;
}

export interface ManifestRoute {
  path: string;
  module: string;
  hasLoader: boolean;
  tagName?: string;
  layouts?: string[];
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
}
