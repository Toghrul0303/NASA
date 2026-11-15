/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_DATA_BASE?: string
  readonly VITE_HIPS_SURVEY_BASE?: string
  readonly VITE_FEATURE_G1_CUBE?: string
  readonly VITE_SPHEREX_CUBE_HIPS_URL?: string
  readonly VITE_IRSA_SPECTROPHOTOMETRY_URL?: string
  readonly VITE_IRSA_MOST_URL?: string
  readonly VITE_USE_MOCKS?: string
  readonly VITE_MOCK_JOB_DELAY_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
