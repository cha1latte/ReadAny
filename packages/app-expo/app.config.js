const { getAppVariantConfig } = require("./scripts/app-variant");
const { getShlaiVersionConfig } = require("./scripts/shlai-version");

const variant = getAppVariantConfig();
const release = getShlaiVersionConfig();

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
        NSCameraUsageDescription:
          `${variant.name} uses the camera to scan sync and configuration QR codes.`,
        NSLocalNetworkUsageDescription:
          `${variant.name} uses the local network to connect to sync devices and the development server while debugging.`,
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
      ],
    },
    plugins: [
      [
        "expo-dev-client",
        {
          launchMode: "launcher",
        },
      ],
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
      "onnxruntime-react-native",
      "./plugins/withOnnxruntimePackage",
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
      releaseApiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      releaseTagPrefix: "shlai-v",
      releaseAssetName: "ReadAny-Shlai.apk",
    },
  },
};
