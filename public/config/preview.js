window.config = {
  path: '/',
  servers: [
    {
      id: 'preview',
      url: "https://proxy.imaging.datacommons.cancer.gov/current/viewer-only-no-downloads-see-tinyurl-dot-com-slash-3j3d9jyp/dicomWeb",
      write: false
    }
  ],
  oidc: {
    authority: "https://accounts.google.com",
    clientId: "293449031882-k4um45hl4g94fsgbnviel0lh38836i9v.apps.googleusercontent.com",
    scope: "email profile openid https://www.googleapis.com/auth/cloud-healthcare",
    grantType: "implicit"
  },
  disableWorklist: false,
  disableAnnotationTools: false,
  enableServerSelection: true,
  mode: "light",
  preload: true,
  annotations: [
    {
      finding: { value: '85756007', schemeDesignator: 'SCT', meaning: 'Tissue' },
      style: {
        stroke: {
          color: [51, 204, 51, 1],
          width: 2
        },
        fill: {
          color: [255, 255, 255, 0.2]
        }
      }
    },
  ]
}
