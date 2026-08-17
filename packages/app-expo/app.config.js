const { getAppVariantConfig } = require("./scripts/app-variant");
const { getShlaiVersionConfig } = require("./scripts/shlai-version");

const variant = getAppVariantConfig();
const release = getShlaiVersionConfig();
const isPreview = variant.key === "preview";

module.exports = {
  expo: {
    name: variant.name,
    slug: "readany-shlai",
    version: release.version,
    orientation: "portrait",
    icon: "./assets/shlai/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/shlai/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#05042B",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: variant.bundleIdentifier,
      buildNumber: "2",
      infoPlist: {
        UIBackgroundModes: ["audio"],
        NSCameraUsageDescription: `${variant.name} uses the camera to scan sync and configuration QR codes.`,
        NSLocalNetworkUsageDescription: `${variant.name} uses the local network to connect to sync devices and the development server while debugging.`,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/shlai/adaptive-icon.png",
        backgroundColor: "#05042B",
      },
      versionCode: release.versionCode,
      softwareKeyboardLayoutMode: "resize",
      package: variant.androidPackage,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        ...(isPreview ? ["android.permission.REQUEST_INSTALL_PACKAGES"] : []),
      ],
    },
    plugins: [
      ...(variant.key === "development"
        ? [
            [
              "expo-dev-client",
              {
                launchMode: "launcher",
              },
            ],
          ]
        : []),
      [
        "expo-av",
        {
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            enableMinifyInReleaseBuilds: true,
            usesCleartextTraffic: true,
          },
        },
      ],
      "./plugins/withGradleMemory",
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission: `${variant.name} uses your photo library to choose custom book covers.`,
        },
      ],
      "expo-secure-store",
      "expo-sqlite",
      "expo-asset",
      "./plugins/withOnnxruntimePackage",
      "onnxruntime-react-native",
      "./plugins/withVolumeKeyPaging",
      [
        "expo-camera",
        {
          cameraPermission: `Allow ${variant.name} to use your camera to scan sync QR codes.`,
        },
      ],
    ],
    scheme: variant.scheme,
    extra: {
      appVariant: variant.key,
      shlaiRevision: release.revision,
      upstreamRepository: "codedogQBY/ReadAny",
      forkRepository: "cha1latte/ReadAny",
      releaseApiUrl: isPreview
        ? "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100"
        : "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      releaseTagPrefix: isPreview ? "shlai-preview-v" : "shlai-v",
      releaseMode: isPreview ? "canonical-prerelease-list" : "single",
      releaseAssetName: isPreview ? "ReadAny-Shlai-Preview.apk" : "ReadAny-Shlai.apk",
      ...(isPreview ? { releaseChecksumAssetName: "ReadAny-Shlai-Preview.apk.sha256" } : {}),
    },
  },
};
