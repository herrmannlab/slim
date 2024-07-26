import React from 'react'
import {
  FaCrosshairs,
  FaDrawPolygon,
  FaEye,
  FaEyeSlash,
  FaHandPaper,
  FaHandPointer,
  FaTrash,
  FaSave
} from 'react-icons/fa'
import {
  Button as Btn,
  Checkbox,
  Descriptions,
  Divider,
  InputNumber,
  message,
  Menu,
  Modal,
  Layout,
  Row,
  Select,
  Space,
  Tooltip
} from 'antd'
import { UndoOutlined, CheckOutlined, StopOutlined } from '@ant-design/icons'
import * as dmv from 'dicom-microscopy-viewer'
import * as dcmjs from 'dcmjs'
import * as dwc from 'dicomweb-client'

import DicomWebManager from '../DicomWebManager'
import AnnotationList from './AnnotationList'
import AnnotationGroupList from './AnnotationGroupList'
import Button from './Button'
import Equipment from './Equipment'
import Report, { MeasurementReport } from './Report'
import SpecimenList from './SpecimenList'
import OpticalPathList from './OpticalPathList'
import MappingList from './MappingList'
import SegmentList from './SegmentList'
import { AnnotationSettings } from '../AppConfig'
import { Slide } from '../data/slides'
import { StorageClasses } from '../data/uids'
import { findContentItemsByName } from '../utils/sr'
import { RouteComponentProps, withRouter } from '../utils/router'
import { CustomError, errorTypes } from '../utils/CustomError'
import NotificationMiddleware, {
  NotificationMiddlewareContext
} from '../services/NotificationMiddleware'
import AnnotationCategoryList from './AnnotationCategoryList'
import HoveredRoiTooltip from './HoveredRoiTooltip'

const DEFAULT_ROI_STROKE_COLOR: number[] = [255, 234, 0] // [0, 126, 163]
const DEFAULT_ROI_FILL_COLOR: number[] = [255, 234, 0, 0.2] // [0, 126, 163, 0.2]
const DEFAULT_ROI_STROKE_WIDTH: number = 2
const DEFAULT_ROI_RADIUS: number = 5

const _buildKey = (concept: {
  CodeValue: string
  CodeMeaning: string
  CodingSchemeDesignator: string
  CodingSchemeVersion?: string
}): string => {
  const codingScheme = concept.CodingSchemeDesignator
  const codeValue = concept.CodeValue
  return `${codingScheme}-${codeValue}`
}

const _getRoiKey = (roi: dmv.roi.ROI): string | undefined => {
  const matches = findContentItemsByName({
    content: roi.evaluations,
    name: new dcmjs.sr.coding.CodedConcept({
      value: '121071',
      meaning: 'Finding',
      schemeDesignator: 'DCM'
    })
  })
  if (matches.length === 0) {
    console.warn(`no finding found for ROI ${roi.uid}`)
    return
  }
  const finding = matches[0] as dcmjs.sr.valueTypes.CodeContentItem
  const findingName = finding.ConceptCodeSequence[0]
  return _buildKey(findingName)
}

const _areROIsEqual = (a: dmv.roi.ROI, b: dmv.roi.ROI): boolean => {
  if (a.scoord3d.graphicType !== b.scoord3d.graphicType) {
    return false
  }
  if (a.scoord3d.frameOfReferenceUID !== b.scoord3d.frameOfReferenceUID) {
    return false
  }
  if (a.scoord3d.graphicData.length !== b.scoord3d.graphicData.length) {
    return false
  }

  const decimals = 6
  for (let i = 0; i < a.scoord3d.graphicData.length; ++i) {
    if (a.scoord3d.graphicType === 'POINT') {
      const s1 = a.scoord3d as dmv.scoord3d.Point
      const s2 = b.scoord3d as dmv.scoord3d.Point
      const c1 = s1.graphicData[i].toPrecision(decimals)
      const c2 = s2.graphicData[i].toPrecision(decimals)
      if (c1 !== c2) {
        return false
      }
    } else {
      const s1 = a.scoord3d as dmv.scoord3d.Polygon
      const s2 = b.scoord3d as dmv.scoord3d.Polygon
      for (let j = 0; j < s1.graphicData[i].length; ++j) {
        const c1 = s1.graphicData[i][j].toPrecision(decimals)
        const c2 = s2.graphicData[i][j].toPrecision(decimals)
        if (c1 !== c2) {
          return false
        }
      }
    }
  }
  return true
}

const _formatRoiStyle = (style: {
  stroke?: {
    color?: number[]
    width?: number
  }
  fill?: {
    color?: number[]
  }
  radius?: number
}): dmv.viewer.ROIStyleOptions => {
  const stroke = {
    color: DEFAULT_ROI_STROKE_COLOR,
    width: DEFAULT_ROI_STROKE_WIDTH
  }
  if (style.stroke != null) {
    if (style.stroke.color != null) {
      stroke.color = style.stroke.color
    }
    if (style.stroke.width != null) {
      stroke.width = style.stroke.width
    }
  }
  const fill = {
    color: DEFAULT_ROI_FILL_COLOR
  }
  if (style.fill != null) {
    if (style.fill.color != null) {
      fill.color = style.fill.color
    }
  }
  return {
    stroke,
    fill,
    image: {
      circle: {
        radius: style.radius != null
          ? style.radius
          : Math.max(5 - stroke.width, 1),
        stroke,
        fill
      }
    }
  }
}

const _constructViewers = ({ clients, slide, preload }: {
  clients: { [key: string]: dwc.api.DICOMwebClient }
  slide: Slide
  preload?: boolean
}): {
  volumeViewer: dmv.viewer.VolumeImageViewer
  labelViewer?: dmv.viewer.LabelImageViewer
} => {
  console.info(
    'instantiate viewer for VOLUME images of slide ' +
    `"${slide.volumeImages[0].ContainerIdentifier}"`
  )
  try {
    const volumeViewer = new dmv.viewer.VolumeImageViewer({
      clientMapping: clients,
      metadata: slide.volumeImages,
      controls: ['overview', 'position'],
      preload: preload,
      errorInterceptor: (error: CustomError) => {
        NotificationMiddleware.onError(
          NotificationMiddlewareContext.DMV, error
        )
      }
    })
    volumeViewer.activateSelectInteraction({})

    let labelViewer
    if (slide.labelImages.length > 0) {
      console.info(
        'instantiate viewer for LABEL image of slide ' +
        `"${slide.labelImages[0].ContainerIdentifier}"`
      )
      labelViewer = new dmv.viewer.LabelImageViewer({
        client: clients[StorageClasses.VL_WHOLE_SLIDE_MICROSCOPY_IMAGE],
        metadata: slide.labelImages[0],
        resizeFactor: 1,
        orientation: 'vertical',
        errorInterceptor: (error: CustomError) => {
          NotificationMiddleware.onError(
            NotificationMiddlewareContext.DMV,
            error
          )
        }
      })
    }

    return { volumeViewer, labelViewer }
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    NotificationMiddleware.onError(
      NotificationMiddlewareContext.SLIM,
      new CustomError(
        errorTypes.VISUALIZATION,
        'Failed to instantiate viewer'
      )
    )
    throw error
  }
}

/*
 * Check whether the report is structured according to template
 * TID 1500 "MeasurementReport".
 */
const _implementsTID1500 = (
  report: dmv.metadata.Comprehensive3DSR
): boolean => {
  const templateSeq = report.ContentTemplateSequence
  if (templateSeq.length > 0) {
    const tid = templateSeq[0].TemplateIdentifier
    if (tid === '1500') {
      return true
    }
  }
  return false
}

/*
 * Check whether the subject described in the report is a specimen as compared
 * to a patient, fetus, or device.
 */
const _describesSpecimenSubject = (
  report: dmv.metadata.Comprehensive3DSR
): boolean => {
  const items = findContentItemsByName({
    content: report.ContentSequence,
    name: new dcmjs.sr.coding.CodedConcept({
      value: '121024',
      schemeDesignator: 'DCM',
      meaning: 'Subject Class'
    })
  })
  if (items.length === 0) {
    return false
  }
  const subjectClassItem = items[0] as dcmjs.sr.valueTypes.CodeContentItem
  const subjectClassValue = subjectClassItem.ConceptCodeSequence[0]
  const retrievedConcept = new dcmjs.sr.coding.CodedConcept({
    value: subjectClassValue.CodeValue,
    meaning: subjectClassValue.CodeMeaning,
    schemeDesignator: subjectClassValue.CodingSchemeDesignator
  })
  const expectedConcept = new dcmjs.sr.coding.CodedConcept({
    value: '121027',
    meaning: 'Specimen',
    schemeDesignator: 'DCM'
  })
  if (retrievedConcept.equals(expectedConcept)) {
    return true
  }
  return false
}

/*
 * Check whether the report contains appropriate graphic ROI annotations.
 */
const _containsROIAnnotations = (
  report: dmv.metadata.Comprehensive3DSR
): boolean => {
  const measurements = findContentItemsByName({
    content: report.ContentSequence,
    name: new dcmjs.sr.coding.CodedConcept({
      value: '126010',
      schemeDesignator: 'DCM',
      meaning: 'Imaging Measurements'
    })
  })
  if (measurements.length === 0) {
    return false
  }
  const container = measurements[0] as dcmjs.sr.valueTypes.ContainerContentItem
  const measurementGroups = findContentItemsByName({
    content: container.ContentSequence,
    name: new dcmjs.sr.coding.CodedConcept({
      value: '125007',
      schemeDesignator: 'DCM',
      meaning: 'Measurement Group'
    })
  })

  let foundRegion = false
  measurementGroups.forEach((group) => {
    const container = group as dcmjs.sr.valueTypes.ContainerContentItem
    const regions = findContentItemsByName({
      content: container.ContentSequence,
      name: new dcmjs.sr.coding.CodedConcept({
        value: '111030',
        schemeDesignator: 'DCM',
        meaning: 'Image Region'
      })
    })
    if (regions.length > 0) {
      if (regions[0].ValueType === dcmjs.sr.valueTypes.ValueTypes.SCOORD3D) {
        foundRegion = true
      }
    }
  })

  return foundRegion
}

interface EvaluationOptions {
  name: dcmjs.sr.coding.CodedConcept
  values: dcmjs.sr.coding.CodedConcept[]
}

interface Evaluation {
  name: dcmjs.sr.coding.CodedConcept
  value: dcmjs.sr.coding.CodedConcept
}

interface Measurement {
  name: dcmjs.sr.coding.CodedConcept
  value?: number
  unit: dcmjs.sr.coding.CodedConcept
}

interface SlideViewerProps extends RouteComponentProps {
  slide: Slide
  clients: { [key: string]: DicomWebManager }
  studyInstanceUID: string
  seriesInstanceUID: string
  app: {
    name: string
    version: string
    uid: string
    organization?: string
  }
  preload?: boolean
  annotations: AnnotationSettings[]
  enableAnnotationTools: boolean
  user?: {
    name: string
    email: string
  }
  selectedPresentationStateUID?: string
}

interface SlideViewerState {
  visibleRoiUIDs: Set<string>
  visibleSegmentUIDs: Set<string>
  visibleMappingUIDs: Set<string>
  visibleAnnotationGroupUIDs: Set<string>
  visibleOpticalPathIdentifiers: Set<string>
  activeOpticalPathIdentifiers: Set<string>
  presentationStates: dmv.metadata.AdvancedBlendingPresentationState[]
  selectedPresentationStateUID?: string
  selectedFinding?: dcmjs.sr.coding.CodedConcept
  selectedEvaluations: Evaluation[]
  selectedGeometryType?: string
  selectedMarkup?: string
  selectedRoi?: dmv.roi.ROI
  selectedRoiUIDs: Set<string>
  generatedReport?: dmv.metadata.Comprehensive3DSR
  isLoading: boolean
  isAnnotationModalVisible: boolean
  isSelectedRoiModalVisible: boolean
  isHoveredRoiTooltipVisible: boolean
  hoveredRoi?: dmv.roi.ROI
  hoveredRoiAttributes: Array<{ name: string, value: string }>
  hoveredRoiTooltipX: number
  hoveredRoiTooltipY: number
  isReportModalVisible: boolean
  isRoiDrawingActive: boolean
  isRoiModificationActive: boolean
  isRoiTranslationActive: boolean
  isGoToModalVisible: boolean
  isSelectedMagnificationValid: boolean
  isSelectedXCoordinateValid: boolean
  isSelectedYCoordinateValid: boolean
  selectedXCoordinate?: number
  validXCoordinateRange: number[]
  selectedYCoordinate?: number
  validYCoordinateRange: number[]
  selectedMagnification?: number
  areRoisHidden: boolean
  pixelDataStatistics: {
    [opticalPathIdentifier: string]: {
      min: number
      max: number
      numFramesSampled: number
    }
  }
  loadingFrames: Set<string>
}

/**
 * React component for interactive viewing of an individual digital slide,
 * which corresponds to one DICOM Series of DICOM Slide Microscopy images and
 * potentially one or more associated DICOM Series of DICOM SR documents.
 */
class SlideViewer extends React.Component<SlideViewerProps, SlideViewerState> {
  private readonly findingOptions: dcmjs.sr.coding.CodedConcept[] = []

  private readonly evaluationOptions: { [key: string]: EvaluationOptions[] } = {}

  private readonly measurements: Measurement[] = []

  private readonly geometryTypeOptions: { [key: string]: string[] } = {}

  private readonly volumeViewportRef: React.RefObject<HTMLDivElement>

  private readonly labelViewportRef: React.RefObject<HTMLDivElement>

  private volumeViewer: dmv.viewer.VolumeImageViewer

  private labelViewer?: dmv.viewer.LabelImageViewer

  private readonly defaultRoiStyle: dmv.viewer.ROIStyleOptions = {
    stroke: {
      color: DEFAULT_ROI_STROKE_COLOR,
      width: DEFAULT_ROI_STROKE_WIDTH
    },
    fill: {
      color: DEFAULT_ROI_FILL_COLOR
    },
    image: {
      circle: {
        fill: {
          color: DEFAULT_ROI_STROKE_COLOR
        },
        radius: DEFAULT_ROI_RADIUS
      }
    }
  }

  private roiStyles: {[key: string]: dmv.viewer.ROIStyleOptions} = {}

  private readonly selectionColor: number[] = [140, 184, 198]

  private readonly selectedRoiStyle: dmv.viewer.ROIStyleOptions = {
    stroke: { color: [...this.selectionColor, 1], width: 3 },
    fill: { color: [...this.selectionColor, 0.2] },
    image: {
      circle: {
        radius: 5,
        fill: { color: [...this.selectionColor, 1] }
      }
    }
  }

  constructor (props: SlideViewerProps) {
    super(props)
    console.info(
      `view slide "${this.props.slide.containerIdentifier}": `,
      this.props.slide
    )
    const geometryTypeOptions = [
      'point',
      'circle',
      'box',
      'polygon',
      'line',
      'freehandpolygon',
      'freehandline'
    ]
    props.annotations.forEach((annotation: AnnotationSettings) => {
      const finding = new dcmjs.sr.coding.CodedConcept(annotation.finding)
      this.findingOptions.push(finding)
      const key = _buildKey(finding)
      if (annotation.geometryTypes !== undefined) {
        this.geometryTypeOptions[key] = annotation.geometryTypes
      } else {
        this.geometryTypeOptions[key] = geometryTypeOptions
      }
      this.evaluationOptions[key] = []
      if (annotation.evaluations !== undefined) {
        annotation.evaluations.forEach(evaluation => {
          this.evaluationOptions[key].push({
            name: new dcmjs.sr.coding.CodedConcept(evaluation.name),
            values: evaluation.values.map(value => {
              return new dcmjs.sr.coding.CodedConcept(value)
            })
          })
        })
      }
      if (annotation.measurements !== undefined) {
        annotation.measurements.forEach(measurement => {
          this.measurements.push({
            name: new dcmjs.sr.coding.CodedConcept(measurement.name),
            value: undefined,
            unit: new dcmjs.sr.coding.CodedConcept(measurement.unit)
          })
        })
      }
      if (annotation.style != null) {
        this.roiStyles[key] = _formatRoiStyle(annotation.style)
      } else {
        this.roiStyles[key] = this.defaultRoiStyle
      }
    })

    this.componentSetup = this.componentSetup.bind(this)
    this.componentCleanup = this.componentCleanup.bind(this)

    this.onWindowResize = this.onWindowResize.bind(this)
    this.handleRoiDrawing = this.handleRoiDrawing.bind(this)
    this.handleRoiTranslation = this.handleRoiTranslation.bind(this)
    this.handleRoiModification = this.handleRoiModification.bind(this)
    this.handleRoiVisibilityChange = this.handleRoiVisibilityChange.bind(this)
    this.handleRoiRemoval = this.handleRoiRemoval.bind(this)
    this.handleRoiSelectionCancellation = this.handleRoiSelectionCancellation.bind(this)
    this.handleAnnotationConfigurationCancellation = this.handleAnnotationConfigurationCancellation.bind(this)
    this.handleAnnotationGeometryTypeSelection = this.handleAnnotationGeometryTypeSelection.bind(this)
    this.handleAnnotationMeasurementActivation = this.handleAnnotationMeasurementActivation.bind(this)
    this.handleAnnotationFindingSelection = this.handleAnnotationFindingSelection.bind(this)
    this.handleAnnotationEvaluationSelection = this.handleAnnotationEvaluationSelection.bind(this)
    this.handleAnnotationEvaluationClearance = this.handleAnnotationEvaluationClearance.bind(this)
    this.handleAnnotationConfigurationCompletion = this.handleAnnotationConfigurationCompletion.bind(this)
    this.handleAnnotationSelection = this.handleAnnotationSelection.bind(this)
    this.handleAnnotationVisibilityChange = this.handleAnnotationVisibilityChange.bind(this)
    this.handleAnnotationGroupVisibilityChange = this.handleAnnotationGroupVisibilityChange.bind(this)
    this.handleAnnotationGroupStyleChange = this.handleAnnotationGroupStyleChange.bind(this)
    this.handleGoTo = this.handleGoTo.bind(this)
    this.handleXCoordinateSelection = this.handleXCoordinateSelection.bind(this)
    this.handleYCoordinateSelection = this.handleYCoordinateSelection.bind(this)
    this.handleMagnificationSelection = this.handleMagnificationSelection.bind(this)
    this.handleSlidePositionSelection = this.handleSlidePositionSelection.bind(this)
    this.handleSlidePositionSelectionCancellation = this.handleSlidePositionSelectionCancellation.bind(this)
    this.handleReportGeneration = this.handleReportGeneration.bind(this)
    this.handleReportVerification = this.handleReportVerification.bind(this)
    this.handleReportCancellation = this.handleReportCancellation.bind(this)
    this.handleSegmentVisibilityChange = this.handleSegmentVisibilityChange.bind(this)
    this.handleSegmentStyleChange = this.handleSegmentStyleChange.bind(this)
    this.handleMappingVisibilityChange = this.handleMappingVisibilityChange.bind(this)
    this.handleMappingStyleChange = this.handleMappingStyleChange.bind(this)
    this.handleOpticalPathVisibilityChange = this.handleOpticalPathVisibilityChange.bind(this)
    this.handleOpticalPathStyleChange = this.handleOpticalPathStyleChange.bind(this)
    this.handleOpticalPathActivityChange = this.handleOpticalPathActivityChange.bind(this)
    this.handlePresentationStateSelection = this.handlePresentationStateSelection.bind(this)
    this.handlePresentationStateReset = this.handlePresentationStateReset.bind(this)

    const { volumeViewer, labelViewer } = _constructViewers({
      clients: this.props.clients,
      slide: this.props.slide,
      preload: this.props.preload
    })
    this.volumeViewer = volumeViewer
    this.labelViewer = labelViewer
    this.volumeViewportRef = React.createRef<HTMLDivElement>()
    this.labelViewportRef = React.createRef<HTMLDivElement>()

    /**
     * Deactivate all optical paths. Visibility will be set later, potentially
     * using based on available presentation state instances.
     */
    this.volumeViewer.getAllOpticalPaths().forEach(opticalPath => {
      this.volumeViewer.deactivateOpticalPath(opticalPath.identifier)
    })

    const [offset, size] = this.volumeViewer.boundingBox

    this.state = {
      selectedRoiUIDs: new Set(),
      visibleRoiUIDs: new Set(),
      visibleSegmentUIDs: new Set(),
      visibleMappingUIDs: new Set(),
      visibleAnnotationGroupUIDs: new Set(),
      visibleOpticalPathIdentifiers: new Set(),
      activeOpticalPathIdentifiers: new Set(),
      presentationStates: [],
      selectedFinding: undefined,
      selectedEvaluations: [],
      generatedReport: undefined,
      isLoading: false,
      isAnnotationModalVisible: false,
      isSelectedRoiModalVisible: false,
      isHoveredRoiTooltipVisible: false,
      hoveredRoiTooltipX: 0,
      hoveredRoiTooltipY: 0,
      hoveredRoiAttributes: [],
      isSelectedMagnificationValid: false,
      isReportModalVisible: false,
      isRoiDrawingActive: false,
      isRoiTranslationActive: false,
      isRoiModificationActive: false,
      isGoToModalVisible: false,
      isSelectedXCoordinateValid: false,
      isSelectedYCoordinateValid: false,
      selectedXCoordinate: undefined,
      validXCoordinateRange: [offset[0], offset[0] + size[0]],
      selectedYCoordinate: undefined,
      validYCoordinateRange: [offset[1], offset[1] + size[1]],
      selectedMagnification: undefined,
      areRoisHidden: false,
      pixelDataStatistics: {},
      selectedPresentationStateUID: this.props.selectedPresentationStateUID,
      loadingFrames: new Set()
    }
  }

  componentDidUpdate (
    previousProps: SlideViewerProps,
    previousState: SlideViewerState
  ): void {
    /** Fetch data and update the viewports if the route has changed (
     * i.e., if another series has been selected) or if the client has changed.
     */
    if (
      this.props.location.pathname !== previousProps.location.pathname ||
      this.props.studyInstanceUID !== previousProps.studyInstanceUID ||
      this.props.seriesInstanceUID !== previousProps.seriesInstanceUID ||
      this.props.slide !== previousProps.slide ||
      this.props.clients !== previousProps.clients
    ) {
      if (this.volumeViewportRef.current != null) {
        this.volumeViewportRef.current.innerHTML = ''
      }
      this.volumeViewer.cleanup()
      if (this.labelViewer != null) {
        if (this.labelViewportRef.current != null) {
          this.labelViewportRef.current.innerHTML = ''
        }
        this.labelViewer.cleanup()
      }
      const { volumeViewer, labelViewer } = _constructViewers({
        clients: this.props.clients,
        slide: this.props.slide,
        preload: this.props.preload
      })
      this.volumeViewer = volumeViewer
      this.labelViewer = labelViewer

      const activeOpticalPathIdentifiers: Set<string> = new Set()
      const visibleOpticalPathIdentifiers: Set<string> = new Set()
      this.volumeViewer.getAllOpticalPaths().forEach(opticalPath => {
        const identifier = opticalPath.identifier
        if (this.volumeViewer.isOpticalPathVisible(identifier)) {
          visibleOpticalPathIdentifiers.add(identifier)
        }
        if (this.volumeViewer.isOpticalPathActive(identifier)) {
          activeOpticalPathIdentifiers.add(identifier)
        }
      })

      const [offset, size] = this.volumeViewer.boundingBox

      this.setState({
        visibleRoiUIDs: new Set(),
        visibleSegmentUIDs: new Set(),
        visibleMappingUIDs: new Set(),
        visibleAnnotationGroupUIDs: new Set(),
        visibleOpticalPathIdentifiers,
        activeOpticalPathIdentifiers,
        presentationStates: [],
        loadingFrames: new Set(),
        validXCoordinateRange: [offset[0], offset[0] + size[0]],
        validYCoordinateRange: [offset[1], offset[1] + size[1]]
      })
      this.populateViewports()
    }
  }

  /**
   * Retrieve Presentation State instances that reference the any images of
   * the currently selected series.
   */
  loadPresentationStates = (): void => {
    console.info('search for Presentation State instances')
    const client = this.props.clients[
      StorageClasses.ADVANCED_BLENDING_PRESENTATION_STATE
    ]
    client.searchForInstances({
      studyInstanceUID: this.props.studyInstanceUID,
      queryParams: {
        Modality: 'PR'
      }
    }).then((matchedInstances): void => {
      if (matchedInstances == null) {
        matchedInstances = []
      }
      matchedInstances.forEach((rawInstance, index) => {
        const { dataset } = dmv.metadata.formatMetadata(rawInstance)
        const instance = dataset as dmv.metadata.Instance
        console.info(`retrieve PR instance "${instance.SOPInstanceUID}"`)
        client.retrieveInstance({
          studyInstanceUID: this.props.studyInstanceUID,
          seriesInstanceUID: instance.SeriesInstanceUID,
          sopInstanceUID: instance.SOPInstanceUID
        }).then((retrievedInstance): void => {
          const data = dcmjs.data.DicomMessage.readFile(retrievedInstance)
          const { dataset } = dmv.metadata.formatMetadata(data.dict)
          if (this.props.slide.areVolumeImagesMonochrome) {
            const presentationState = (
              dataset as
              unknown as
              dmv.metadata.AdvancedBlendingPresentationState
            )
            let doesMatch = false
            presentationState.AdvancedBlendingSequence.forEach(blendingItem => {
              doesMatch = this.props.slide.seriesInstanceUIDs.includes(
                blendingItem.SeriesInstanceUID
              )
            }
            )
            if (doesMatch) {
              console.info(
                'include Advanced Blending Presentation State instance ' +
                `"${presentationState.SOPInstanceUID}"`
              )
              if (
                index === 0 &&
                this.props.selectedPresentationStateUID == null
              ) {
                this.setPresentationState(presentationState)
              } else {
                if (
                  presentationState.SOPInstanceUID ===
                  this.props.selectedPresentationStateUID
                ) {
                  this.setPresentationState(presentationState)
                }
              }
              this.setState(state => {
                const mapping: {
                  [sopInstanceUID: string]:
                  dmv.metadata.AdvancedBlendingPresentationState
                } = {}
                state.presentationStates.forEach(instance => {
                  mapping[instance.SOPInstanceUID] = instance
                })
                mapping[presentationState.SOPInstanceUID] = presentationState
                return { presentationStates: Object.values(mapping) }
              })
            }
          } else {
            console.info(
              `ignore presentation state "${instance.SOPInstanceUID}", ` +
              'application of presentation states for color images ' +
              'has not (yet) been implemented'
            )
          }
        }).catch((error) => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          NotificationMiddleware.onError(
            NotificationMiddlewareContext.SLIM,
            new CustomError(
              errorTypes.VISUALIZATION,
              'Presentation State could not be loaded'
            )
          )
          console.error(
            'failed to load presentation state ' +
            `of SOP instance "${instance.SOPInstanceUID}" ` +
            `of series "${instance.SeriesInstanceUID}" ` +
            `of study "${this.props.studyInstanceUID}": `,
            error
          )
        })
      })
    }).catch((error) => {
      console.error(error)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Presentation State could not be loaded'
        )
      )
    })
  }

  /**
   * Set presentation state as specified by a DICOM Presentation State instance.
   */
  setPresentationState = (
    presentationState: dmv.metadata.AdvancedBlendingPresentationState
  ): void => {
    const opticalPaths = this.volumeViewer.getAllOpticalPaths()
    console.info(
      `apply Presentation State instance "${presentationState.SOPInstanceUID}"`
    )
    const opticalPathStyles: {
      [opticalPathIdentifier: string]: {
        opacity: number
        paletteColorLookupTable?: dmv.color.PaletteColorLookupTable
        limitValues?: number[]
      } | null
    } = {}
    opticalPaths.forEach(opticalPath => {
      // First, deactivate and hide all optical paths and reset style
      const identifier = opticalPath.identifier
      this.volumeViewer.hideOpticalPath(identifier)
      this.volumeViewer.deactivateOpticalPath(identifier)
      const style = this.volumeViewer.getOpticalPathDefaultStyle(identifier)
      this.volumeViewer.setOpticalPathStyle(identifier, style)

      presentationState.AdvancedBlendingSequence.forEach(blendingItem => {
        /**
         * Referenced Instance Sequence should be used instead of Referenced
         * Image Sequence, but that's easy to mix up and we have encountered
         * implementations that get it wrong.
         */
        let refInstanceItems = blendingItem.ReferencedInstanceSequence
        if (refInstanceItems === undefined) {
          refInstanceItems = blendingItem.ReferencedImageSequence
        }
        if (refInstanceItems === undefined) {
          return
        }
        refInstanceItems.forEach(imageItem => {
          const isReferenced = opticalPath.sopInstanceUIDs.includes(
            imageItem.ReferencedSOPInstanceUID
          ) as boolean
          if (isReferenced) {
            let paletteColorLUT
            if (blendingItem.PaletteColorLookupTableSequence != null) {
              const cpLUTItem = blendingItem.PaletteColorLookupTableSequence[0]
              paletteColorLUT = new dmv.color.PaletteColorLookupTable({
                uid: (
                  cpLUTItem.PaletteColorLookupTableUID != null
                    ? cpLUTItem.PaletteColorLookupTableUID
                    : ''
                ),
                redDescriptor:
                  cpLUTItem.RedPaletteColorLookupTableDescriptor,
                greenDescriptor:
                  cpLUTItem.GreenPaletteColorLookupTableDescriptor,
                blueDescriptor:
                  cpLUTItem.BluePaletteColorLookupTableDescriptor,
                redData: (
                  (cpLUTItem.RedPaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.RedPaletteColorLookupTableData
                    )
                    : undefined
                ),
                greenData: (
                  (cpLUTItem.GreenPaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.GreenPaletteColorLookupTableData
                    )
                    : undefined
                ),
                blueData: (
                  (cpLUTItem.BluePaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.BluePaletteColorLookupTableData
                    )
                    : undefined
                ),
                redSegmentedData: (
                  (cpLUTItem.SegmentedRedPaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.SegmentedRedPaletteColorLookupTableData
                    )
                    : undefined
                ),
                greenSegmentedData: (
                  (cpLUTItem.SegmentedGreenPaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.SegmentedGreenPaletteColorLookupTableData
                    )
                    : undefined
                ),
                blueSegmentedData: (
                  (cpLUTItem.SegmentedBluePaletteColorLookupTableData != null)
                    ? new Uint16Array(
                      cpLUTItem.SegmentedBluePaletteColorLookupTableData
                    )
                    : undefined
                )
              })
            }

            let limitValues
            if (blendingItem.SoftcopyVOILUTSequence != null) {
              const voiLUTItem = blendingItem.SoftcopyVOILUTSequence[0]
              const windowCenter = voiLUTItem.WindowCenter
              const windowWidth = voiLUTItem.WindowWidth
              limitValues = [
                windowCenter - windowWidth * 0.5,
                windowCenter + windowWidth * 0.5
              ]
            }

            opticalPathStyles[identifier] = {
              opacity: 1,
              paletteColorLookupTable: paletteColorLUT,
              limitValues: limitValues
            }
          }
        })
      })
    })

    const selectedOpticalPathIdentifiers: Set<string> = new Set()
    Object.keys(opticalPathStyles).forEach(identifier => {
      const styleOptions = opticalPathStyles[identifier]
      if (styleOptions != null) {
        this.volumeViewer.setOpticalPathStyle(identifier, styleOptions)
        this.volumeViewer.activateOpticalPath(identifier)
        this.volumeViewer.showOpticalPath(identifier)
        selectedOpticalPathIdentifiers.add(identifier)
      } else {
        this.volumeViewer.hideOpticalPath(identifier)
        this.volumeViewer.deactivateOpticalPath(identifier)
      }
    })
    const searchParams = new URLSearchParams(this.props.location.search)
    searchParams.set('state', presentationState.SOPInstanceUID)
    this.props.navigate(
      {
        pathname: this.props.location.pathname,
        search: searchParams.toString()
      },
      { replace: true }
    )
    this.setState(state => ({
      activeOpticalPathIdentifiers: selectedOpticalPathIdentifiers,
      visibleOpticalPathIdentifiers: selectedOpticalPathIdentifiers,
      selectedPresentationStateUID: presentationState.SOPInstanceUID
    }))
  }

  getRoiStyle = (key?: string): dmv.viewer.ROIStyleOptions => {
    if (key == null) {
      return this.defaultRoiStyle
    }
    if (this.roiStyles[key] !== undefined) {
      return this.roiStyles[key]
    }
    return this.defaultRoiStyle
  }

  /**
   * Retrieve Structured Report instances that contain regions of interests
   * with 3D spatial coordinates defined in the same frame of reference as the
   * currently selected series and add them to the VOLUME image viewer.
   */
  addAnnotations = (): void => {
    console.info('search for Comprehensive 3D SR instances')
    const client = this.props.clients[StorageClasses.COMPREHENSIVE_3D_SR]
    client.searchForInstances({
      studyInstanceUID: this.props.studyInstanceUID,
      queryParams: {
        Modality: 'SR'
      }
    }).then((matchedInstances): void => {
      if (matchedInstances == null) {
        matchedInstances = []
      }
      matchedInstances.forEach(i => {
        const { dataset } = dmv.metadata.formatMetadata(i)
        const instance = dataset as dmv.metadata.Instance
        if (instance.SOPClassUID === StorageClasses.COMPREHENSIVE_3D_SR) {
          console.info(`retrieve SR instance "${instance.SOPInstanceUID}"`)
          client.retrieveInstance({
            studyInstanceUID: this.props.studyInstanceUID,
            seriesInstanceUID: instance.SeriesInstanceUID,
            sopInstanceUID: instance.SOPInstanceUID
          }).then((retrievedInstance): void => {
            const data = dcmjs.data.DicomMessage.readFile(retrievedInstance)
            const { dataset } = dmv.metadata.formatMetadata(data.dict)
            const report = dataset as unknown as dmv.metadata.Comprehensive3DSR
            /*
             * Perform a couple of checks to ensure the document content of the
             * report fullfils the requirements of the application.
             */
            if (!_implementsTID1500(report)) {
              console.debug(
                `ignore SR document "${report.SOPInstanceUID}" ` +
                'because it is not structured according to template ' +
                'TID 1500 "MeasurementReport"'
              )
              return
            }
            if (!_describesSpecimenSubject(report)) {
              console.debug(
                `ignore SR document "${report.SOPInstanceUID}" ` +
                'because it does not describe a specimen subject'
              )
              return
            }
            if (!_containsROIAnnotations(report)) {
              console.debug(
                `ignore SR document "${report.SOPInstanceUID}" ` +
                'because it does not contain any suitable ROI annotations'
              )
              return
            }

            const content = new MeasurementReport(report)
            content.ROIs.forEach(roi => {
              console.info(`add ROI "${roi.uid}"`)
              const scoord3d = roi.scoord3d
              const image = this.props.slide.volumeImages[0]
              if (scoord3d.frameOfReferenceUID === image.FrameOfReferenceUID) {
                /*
                 * ROIs may get assigned new UIDs upon re-rendering of the
                 * page and we need to ensure that we don't add them twice.
                 * The same ROI may be stored in multiple SR documents and
                 * we don't want them to show up twice.
                 * TODO: We should probably either "merge" measurements and
                 * quantitative evaluations or pick the ROI from the "best"
                 * available report (COMPLETE and VERIFIED).
                 */
                const doesROIExist = this.volumeViewer.getAllROIs().some(
                  (otherROI: dmv.roi.ROI): boolean => {
                    return _areROIsEqual(otherROI, roi)
                  }
                )
                if (!doesROIExist) {
                  try {
                    // Add ROI without style such that it won't be visible.
                    this.volumeViewer.addROI(roi, {})
                  } catch {
                    console.error(`could not add ROI "${roi.uid}"`)
                  }
                } else {
                  console.debug(`skip already existing ROI "${roi.uid}"`)
                }
              } else {
                console.debug(
                  `skip ROI "${roi.uid}" ` +
                  `of SR document "${report.SOPInstanceUID}"` +
                  'because it is defined in another frame of reference'
                )
              }
            })
          }).catch((error) => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            NotificationMiddleware.onError(
              NotificationMiddlewareContext.SLIM,
              new CustomError(
                errorTypes.VISUALIZATION,
                'Annotations could not be loaded'
              )
            )
            console.error(
              'failed to load ROIs ' +
              `of SOP instance "${instance.SOPInstanceUID}" ` +
              `of series "${instance.SeriesInstanceUID}" ` +
              `of study "${this.props.studyInstanceUID}": `,
              error
            )
          })
          /*
           * React is not aware of the fact that ROIs have been added via the
           * viewer (the viewport is a ref object) and won't show the
           * annotations in the user interface unless an update is forced.
           */
          this.forceUpdate()
        }
      })
    }).catch((error) => {
      console.error(error)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Annotations could not be loaded'
        )
      )
    })
  }

  /**
   * Retrieve Microscopy Bulk Simple Annotations instances that contain
   * annotation groups defined in the same frame of reference as the currently
   * selected series and add them to the VOLUME image viewer.
   */
  addAnnotationGroups = (): void => {
    console.info('search for Microscopy Bulk Simple Annotations instances')
    const client = this.props.clients[
      StorageClasses.MICROSCOPY_BULK_SIMPLE_ANNOTATION
    ]
    client.searchForSeries({
      studyInstanceUID: this.props.studyInstanceUID,
      queryParams: {
        Modality: 'ANN'
      }
    }).then((matchedSeries): void => {
      if (matchedSeries == null) {
        matchedSeries = []
      }
      matchedSeries.forEach(s => {
        const { dataset } = dmv.metadata.formatMetadata(s)
        const series = dataset as dmv.metadata.Series
        client.retrieveSeriesMetadata({
          studyInstanceUID: this.props.studyInstanceUID,
          seriesInstanceUID: series.SeriesInstanceUID
        }).then((retrievedMetadata): void => {
          const annotations: dmv.metadata.MicroscopyBulkSimpleAnnotations[] = retrievedMetadata.map(metadata => {
            return new dmv.metadata.MicroscopyBulkSimpleAnnotations({
              metadata
            })
          })
          // annotations = annotations.filter(ann => {
          //   const refImage = this.props.slide.volumeImages[0]
          //   return (
          //     ann.FrameOfReferenceUID === refImage.FrameOfReferenceUID &&
          //     ann.ContainerIdentifier === refImage.ContainerIdentifier
          //   )
          // })
          annotations.forEach(ann => {
            try {
              this.volumeViewer.addAnnotationGroups(ann)
            } catch (error: any) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              NotificationMiddleware.onError(
                NotificationMiddlewareContext.SLIM,
                new CustomError(
                  errorTypes.VISUALIZATION,
                  'Microscopy Bulk Simple Annotations cannot be displayed.'
                )
              )
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              console.error('failed to add annotation groups:', error)
            }
            ann.AnnotationGroupSequence.forEach(item => {
              const annotationGroupUID = item.AnnotationGroupUID
              const finding = item.AnnotationPropertyTypeCodeSequence[0]
              const key = _buildKey(finding)
              const style = this.roiStyles[key]
              // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
              if (style != null && style.fill != null) {
                this.volumeViewer.setAnnotationGroupStyle(
                  annotationGroupUID,
                  { color: style.fill.color }
                )
              }
            })
          })
          /*
           * React is not aware of the fact that annotation groups have been
           * added via the viewer (the underlying HTML viewport element is a
           * ref object) and won't show the annotation groups in the user
           * interface unless an update is forced.
           */
          this.forceUpdate()
        }).catch((error) => {
          console.error(error)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          NotificationMiddleware.onError(
            NotificationMiddlewareContext.SLIM,
            new CustomError(
              errorTypes.VISUALIZATION,
              'Retrieval of metadata of Microscopy Bulk Simple Annotations ' +
              'instances failed.'
            )
          )
        })
      })
    }).catch((error) => {
      console.error(error)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Search for Microscopy Bulk Simple Annotations instances failed.'
        )
      )
    })
  }

  /**
   * Retrieve Segmentation instances that contain segments defined in the same
   * frame of reference as the currently selected series and add them to the
   * VOLUME image viewer.
   */
  addSegmentations = (): void => {
    console.info('search for Segmentation instances')
    const client = this.props.clients[StorageClasses.SEGMENTATION]
    client.searchForSeries({
      studyInstanceUID: this.props.studyInstanceUID,
      queryParams: {
        Modality: 'SEG'
      }
    }).then((matchedSeries): void => {
      if (matchedSeries == null) {
        matchedSeries = []
      }
      matchedSeries.forEach((s, i) => {
        const { dataset } = dmv.metadata.formatMetadata(s)
        const series = dataset as dmv.metadata.Series
        client.retrieveSeriesMetadata({
          studyInstanceUID: this.props.studyInstanceUID,
          seriesInstanceUID: series.SeriesInstanceUID
        }).then((retrievedMetadata): void => {
          const segmentations: dmv.metadata.Segmentation[] = []
          retrievedMetadata.forEach(metadata => {
            const seg = new dmv.metadata.Segmentation({ metadata })
            const refImage = this.props.slide.volumeImages[0]
            if (
              seg.FrameOfReferenceUID === refImage.FrameOfReferenceUID &&
              seg.ContainerIdentifier === refImage.ContainerIdentifier
            ) {
              segmentations.push(seg)
            }
          })
          if (segmentations.length > 0) {
            try {
              this.volumeViewer.addSegments(segmentations)
            } catch (error: any) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              NotificationMiddleware.onError(
                NotificationMiddlewareContext.SLIM,
                new CustomError(
                  errorTypes.VISUALIZATION,
                  'Segmentations cannot be displayed'
                )
              )
              console.error('failed to add segments: ', error)
            }
            /*
           * React is not aware of the fact that segments have been added via
           * the viewer (the underlying HTML viewport element is a ref object)
           * and won't show the segments in the user interface unless an update
           * is forced.
           */
            this.forceUpdate()
          }
        }).catch((error) => {
          console.error(error)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          NotificationMiddleware.onError(
            NotificationMiddlewareContext.SLIM,
            new CustomError(
              errorTypes.VISUALIZATION,
              'Retrieval of metadata of Segmentation instances failed.'
            )
          )
        })
      })
    }).catch((error) => {
      console.error(error)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Search for Segmentation instances failed.'
        )
      )
    })
  }

  /**
   * Retrieve Parametric Map instances that contain mappings defined in the same
   * frame of reference as the currently selected series and add them to the
   * VOLUME image viewer.
   */
  addParametricMaps = (): void => {
    console.info('search for Parametric Map instances')
    const client = this.props.clients[StorageClasses.PARAMETRIC_MAP]
    client.searchForSeries({
      studyInstanceUID: this.props.studyInstanceUID,
      queryParams: {
        Modality: 'OT'
      }
    }).then((matchedSeries): void => {
      if (matchedSeries == null) {
        matchedSeries = []
      }
      matchedSeries.forEach(s => {
        const { dataset } = dmv.metadata.formatMetadata(s)
        const series = dataset as dmv.metadata.Series
        client.retrieveSeriesMetadata({
          studyInstanceUID: this.props.studyInstanceUID,
          seriesInstanceUID: series.SeriesInstanceUID
        }).then((retrievedMetadata): void => {
          const parametricMaps: dmv.metadata.ParametricMap[] = []
          retrievedMetadata.forEach(metadata => {
            const pm = new dmv.metadata.ParametricMap({ metadata })
            const refImage = this.props.slide.volumeImages[0]
            if (
              pm.FrameOfReferenceUID === refImage.FrameOfReferenceUID &&
              pm.ContainerIdentifier === refImage.ContainerIdentifier
            ) {
              parametricMaps.push(pm)
            } else {
              console.warn(
                `skip Parametric Map instance "${pm.SOPInstanceUID}"`
              )
            }
          })
          if (parametricMaps.length > 0) {
            try {
              this.volumeViewer.addParameterMappings(parametricMaps)
            } catch (error: any) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              NotificationMiddleware.onError(
                NotificationMiddlewareContext.SLIM,
                new CustomError(
                  errorTypes.VISUALIZATION,
                  'Parametric Map cannot be displayed'
                )
              )
              console.error('failed to add mappings: ', error)
            }
            /*
           * React is not aware of the fact that mappings have been added via
           * the viewer (the underlying HTML viewport element is a ref object)
           * and won't show the mappings in the user interface unless an update
           * is forced.
           */
            this.forceUpdate()
          }
        }).catch((error) => {
          console.error(error)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          NotificationMiddleware.onError(
            NotificationMiddlewareContext.SLIM,
            new CustomError(
              errorTypes.VISUALIZATION,
              'Retrieval of metadata of Parametric Map instances failed.'
            )
          )
        })
      })
    }).catch((error) => {
      console.error(error)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Search for Parametric Map instances failed.'
        )
      )
    })
  }

  /**
   * Populate viewports of the VOLUME and LABEL image viewers.
   */
  populateViewports = (): void => {
    console.info('populate viewports...')
    this.setState({
      isLoading: true,
      presentationStates: []
    })

    if (this.volumeViewportRef.current != null) {
      this.volumeViewer.render({ container: this.volumeViewportRef.current })
    }
    if (
      this.labelViewportRef.current != null &&
      this.labelViewer != null
    ) {
      this.labelViewer.render({ container: this.labelViewportRef.current })
    }

    // State update will also ensure that the component is re-rendered.
    this.setState({ isLoading: false })

    this.setDefaultPresentationState()
    this.loadPresentationStates()

    this.addAnnotations()
    this.addAnnotationGroups()
    this.addSegmentations()
    this.addParametricMaps()
  }

  onRoiModified = (event: CustomEventInit): void => {
    // Update state to trigger rendering
    this.setState(state => ({
      visibleRoiUIDs: new Set(state.visibleRoiUIDs)
    }))
  }

  onWindowResize = (event: Event): void => {
    console.info('resize viewports')
    this.volumeViewer.resize()
    if (this.labelViewer != null) {
      this.labelViewer.resize()
    }
  }

  onRoiDrawn = (event: CustomEventInit): void => {
    const roi = event.detail.payload as dmv.roi.ROI
    const selectedFinding = this.state.selectedFinding
    const selectedEvaluations = this.state.selectedEvaluations
    if (roi !== undefined && selectedFinding !== undefined) {
      console.debug(`add ROI "${roi.uid}"`)
      const findingItem = new dcmjs.sr.valueTypes.CodeContentItem({
        name: new dcmjs.sr.coding.CodedConcept({
          value: '121071',
          meaning: 'Finding',
          schemeDesignator: 'DCM'
        }),
        value: selectedFinding,
        relationshipType: 'CONTAINS'
      })
      roi.addEvaluation(findingItem)
      selectedEvaluations.forEach((evaluation: Evaluation) => {
        const item = new dcmjs.sr.valueTypes.CodeContentItem({
          name: evaluation.name,
          value: evaluation.value,
          relationshipType: 'CONTAINS'
        })
        roi.addEvaluation(item)
      })
      const key = _buildKey(selectedFinding)
      const style = this.getRoiStyle(key)
      this.volumeViewer.addROI(roi, style)
      this.setState(state => {
        const visibleRoiUIDs = state.visibleRoiUIDs
        visibleRoiUIDs.add(roi.uid)
        return { visibleRoiUIDs }
      })
    } else {
      console.debug(`could not add ROI "${roi.uid}"`)
    }
  }

  onRoiDoubleClicked = (event: CustomEventInit): void => {
    const selectedRoi = event.detail.payload as dmv.roi.ROI
    if (selectedRoi != null) {
      this.setState({
        isSelectedRoiModalVisible: true
      })
    } else {
      this.setState({
        isSelectedRoiModalVisible: false
      })
    }
  }

  setHoveredRoiAttributes = (hoveredRoi: dmv.roi.ROI): void => {
    const attributes: Array<{ name: string, value: string }> = []
    hoveredRoi.evaluations.forEach((
      item: (
        dcmjs.sr.valueTypes.TextContentItem |
        dcmjs.sr.valueTypes.CodeContentItem
      )
    ) => {
      const nameValue = item.ConceptNameCodeSequence[0].CodeValue
      const nameMeaning = item.ConceptNameCodeSequence[0].CodeMeaning
      const name = `${nameMeaning}`
      if (item.ValueType === dcmjs.sr.valueTypes.ValueTypes.CODE) {
        const codeContentItem = item as dcmjs.sr.valueTypes.CodeContentItem
        const valueMeaning = codeContentItem.ConceptCodeSequence[0].CodeMeaning
        // For consistency with Segment and Annotation Group
        if (nameValue === '276214006') {
          attributes.push({
            name: 'Property category',
            value: `${valueMeaning}`
          })
        } else if (nameValue === '121071') {
          attributes.push({
            name: 'Property type',
            value: `${valueMeaning}`
          })
        } else if (nameValue === '111001') {
          attributes.push({
            name: 'Algorithm Name',
            value: `${valueMeaning}`
          })
        } else {
          attributes.push({
            name: name,
            value: `${valueMeaning}`
          })
        }
      } else if (item.ValueType === dcmjs.sr.valueTypes.ValueTypes.TEXT) {
        const textContentItem = item as dcmjs.sr.valueTypes.TextContentItem
        attributes.push({
          name: name,
          value: textContentItem.TextValue
        })
      }
    })

    this.setState({ hoveredRoiAttributes: attributes })
  }

  onPointerMove = (event: CustomEventInit): void => {
    const { feature: hoveredRoi, event: evt } = event.detail.payload
    if (hoveredRoi != null) {
      const originalEvent = evt.originalEvent
      this.setHoveredRoiAttributes(hoveredRoi)
      this.setState({
        isHoveredRoiTooltipVisible: true,
        hoveredRoi,
        hoveredRoiTooltipX: originalEvent.clientX,
        hoveredRoiTooltipY: originalEvent.clientY
      })
    } else {
      this.setState({
        isHoveredRoiTooltipVisible: false
      })
    }
  }

  onRoiSelected = (event: CustomEventInit): void => {
    const selectedRoi = event.detail.payload as dmv.roi.ROI
    if (selectedRoi != null) {
      console.debug(`selected ROI "${selectedRoi.uid}"`)
      this.volumeViewer.setROIStyle(selectedRoi.uid, this.selectedRoiStyle)
      const key = _getRoiKey(selectedRoi)
      this.volumeViewer.getAllROIs().forEach((roi) => {
        if (roi.uid !== selectedRoi.uid) {
          this.volumeViewer.setROIStyle(roi.uid, this.getRoiStyle(key))
        }
      })
      this.setState({
        selectedRoiUIDs: new Set([selectedRoi.uid]),
        selectedRoi: selectedRoi
      })
    } else {
      this.setState({
        selectedRoiUIDs: new Set(),
        selectedRoi: undefined
      })
    }
  }

  handleRoiSelectionCancellation (): void {
    this.setState({
      isSelectedRoiModalVisible: false
    })
  }

  onLoadingStarted = (event: CustomEventInit): void => {
    this.setState({ isLoading: true })
  }

  onLoadingEnded = (event: CustomEventInit): void => {
    this.setState({ isLoading: false })
  }

  onFrameLoadingStarted = (event: CustomEventInit): void => {
    const frameInfo: {
      studyInstanceUID: string
      seriesInstanceUID: string
      sopInstanceUID: string
      sopClassUID: string
      frameNumber: string
      channelIdentifier: string
    } = event.detail.payload
    const key: string = `${frameInfo.sopInstanceUID}-${frameInfo.frameNumber}`
    this.setState(state => {
      state.loadingFrames.add(key)
      return state
    })
  }

  onFrameLoadingError = (event: CustomEventInit): void => {
    console.error('Failed to load frame')
  }

  onLoadingError = (event: CustomEventInit): void => {
    console.error('Failed to load data')
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    const message = (event.detail?.payload?.message === null ? 'Failed to load data' : event.detail?.payload?.message) as string
    NotificationMiddleware.onError(
      NotificationMiddlewareContext.SLIM,
      new CustomError(
        errorTypes.VISUALIZATION,
        message
      ) as any
    )
  }

  onFrameLoadingEnded = (event: CustomEventInit): void => {
    const frameInfo: {
      studyInstanceUID: string
      seriesInstanceUID: string
      sopInstanceUID: string
      sopClassUID: string
      frameNumber: string
      channelIdentifier: string
      pixelArray: Uint8Array|Uint16Array|Float32Array|null
    } = event.detail.payload
    const key = `${frameInfo.sopInstanceUID}-${frameInfo.frameNumber}`
    this.setState(state => {
      state.loadingFrames.delete(key)
      let isLoading: boolean = false
      if (state.loadingFrames.size > 0) {
        isLoading = true
      }
      return {
        isLoading,
        loadingFrames: state.loadingFrames
      }
    })
    if (
      frameInfo.sopClassUID === StorageClasses.VL_WHOLE_SLIDE_MICROSCOPY_IMAGE &&
      this.props.slide.areVolumeImagesMonochrome
    ) {
      const opticalPathIdentifier = frameInfo.channelIdentifier
      if (
        !(opticalPathIdentifier in this.state.pixelDataStatistics) &&
        frameInfo.pixelArray != null
      ) {
        /*
         * There are limits on the number of arguments Math.min and Math.max
         * functions can accept. Therefore, we compute values in smaller chunks.
         */
        const size = 2 ** 16
        const chunks = Math.ceil(frameInfo.pixelArray.length / size)
        let offset = 0
        const minValues: number[] = []
        const maxValues: number[] = []
        for (let i = 0; i < chunks; i++) {
          offset = i * size
          const pixels = frameInfo.pixelArray.slice(offset, offset + size)
          minValues.push(Math.min(...pixels))
          maxValues.push(Math.max(...pixels))
        }
        const min = Math.min(...minValues)
        const max = Math.max(...maxValues)
        this.setState(state => {
          const stats = state.pixelDataStatistics
          if (stats[opticalPathIdentifier] != null) {
            stats[opticalPathIdentifier] = {
              min: Math.min(stats[opticalPathIdentifier].min, min),
              max: Math.max(stats[opticalPathIdentifier].max, max),
              numFramesSampled: stats[opticalPathIdentifier].numFramesSampled + 1
            }
          } else {
            stats[opticalPathIdentifier] = {
              min: min,
              max: max,
              numFramesSampled: 1
            }
          }
          if (state.selectedPresentationStateUID == null) {
            const style = {
              ...this.volumeViewer.getOpticalPathStyle(opticalPathIdentifier)
            }
            style.limitValues = [
              stats[opticalPathIdentifier].min,
              stats[opticalPathIdentifier].max
            ]
            this.volumeViewer.setOpticalPathStyle(opticalPathIdentifier, style)
          }
          return state
        })
      }
    }
  }

  onRoiRemoved = (event: CustomEventInit): void => {
    const roi = event.detail.payload as dmv.roi.ROI
    console.debug(`removed ROI "${roi.uid}"`)
  }

  componentCleanup (): void {
    document.body.removeEventListener(
      'dicommicroscopyviewer_roi_drawn',
      this.onRoiDrawn
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_roi_selected',
      this.onRoiSelected
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_roi_double_clicked',
      this.onRoiDoubleClicked
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_pointer_move',
      this.onPointerMove
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_roi_removed',
      this.onRoiRemoved
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_roi_modified',
      this.onRoiModified
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_loading_started',
      this.onLoadingStarted
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_loading_ended',
      this.onLoadingEnded
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_frame_loading_started',
      this.onFrameLoadingStarted
    )
    document.body.removeEventListener(
      'dicommicroscopyviewer_frame_loading_ended',
      this.onFrameLoadingEnded
    )
    document.body.removeEventListener(
      'keyup',
      this.onKeyUp
    )
    window.removeEventListener('resize', this.onWindowResize)

    this.volumeViewer.cleanup()
    if (this.labelViewer != null) {
      this.labelViewer.cleanup()
    }
    /*
     * FIXME: React appears to not clean the content of referenced
     * HTMLDivElement objects when the page is reloaded. As a consequence,
     * optical paths and other display items cannot be toggled or updated after
     * a manual page reload. I have tried using ref callbacks and passing the
     * ref objects from the parent component via the props. Both didn't work
     * either.
     */
  }

  onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.state.isRoiDrawingActive) {
        console.info('deactivate drawing of ROIs')
        this.volumeViewer.deactivateDrawInteraction()
        this.volumeViewer.activateSelectInteraction({})
      } else if (this.state.isRoiModificationActive) {
        console.info('deactivate modification of ROIs')
        this.volumeViewer.deactivateModifyInteraction()
        this.volumeViewer.activateSelectInteraction({})
      } else if (this.state.isRoiTranslationActive) {
        console.info('deactivate modification of ROIs')
        this.volumeViewer.deactivateTranslateInteraction()
        this.volumeViewer.activateSelectInteraction({})
      }
      this.setState({
        isAnnotationModalVisible: false,
        isSelectedRoiModalVisible: false,
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false,
        isGoToModalVisible: false
      })
    } else if (event.altKey) {
      if (event.code === 'KeyD') {
        this.handleRoiDrawing()
      } else if (event.code === 'KeyM') {
        this.handleRoiModification()
      } else if (event.code === 'KeyT') {
        this.handleRoiTranslation()
      } else if (event.code === 'KeyR') {
        this.handleRoiRemoval()
      } else if (event.code === 'KeyV') {
        this.handleRoiVisibilityChange()
      } else if (event.code === 'KeyS') {
        this.handleReportGeneration()
      } else if (event.code === 'KeyG') {
        this.handleGoTo()
      }
    }
  }

  componentWillUnmount (): void {
    this.volumeViewer.cleanup()
    if (this.labelViewer != null) {
      this.labelViewer.cleanup()
    }
    window.removeEventListener('beforeunload', this.componentCleanup)
  }

  componentSetup (): void {
    document.body.addEventListener(
      'dicommicroscopyviewer_roi_drawn',
      this.onRoiDrawn
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_roi_selected',
      this.onRoiSelected
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_roi_double_clicked',
      this.onRoiDoubleClicked
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_pointer_move',
      this.onPointerMove
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_roi_removed',
      this.onRoiRemoved
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_roi_modified',
      this.onRoiModified
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_loading_started',
      this.onLoadingStarted
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_loading_ended',
      this.onLoadingEnded
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_loading_error',
      this.onLoadingError
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_frame_loading_started',
      this.onFrameLoadingStarted
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_frame_loading_ended',
      this.onFrameLoadingEnded
    )
    document.body.addEventListener(
      'dicommicroscopyviewer_frame_loading_error',
      this.onFrameLoadingError
    )
    document.body.addEventListener(
      'keyup',
      this.onKeyUp
    )
    window.addEventListener('beforeunload', this.componentCleanup)
    window.addEventListener('resize', this.onWindowResize)
  }

  componentDidMount (): void {
    this.componentSetup()
    this.populateViewports()

    if (!this.props.slide.areVolumeImagesMonochrome) {
      let hasICCProfile = false
      const image = this.props.slide.volumeImages[0]
      const metadataItem = image.OpticalPathSequence[0]
      if (metadataItem.ICCProfile == null) {
        if ('OpticalPathSequence' in image.bulkdataReferences) {
          // @ts-expect-error
          const bulkdataItem = image.bulkdataReferences.OpticalPathSequence[0]
          if ('ICCProfile' in bulkdataItem) {
            hasICCProfile = true
          }
        }
      } else {
        hasICCProfile = true
      }
      if (!hasICCProfile) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        message.warning('No ICC Profile was found for color images')
      }
    }
  }

  /**
   * Handler that gets called when a finding has been selected for annotation.
   *
   * @param value - Code value of the coded finding that got selected
   * @param option - Option that got selected
   */
  handleAnnotationFindingSelection (
    value: string,
    option: any
  ): void {
    this.findingOptions.forEach(finding => {
      if (finding.CodeValue === value) {
        console.info(`selected finding "${finding.CodeMeaning}"`)
        this.setState({
          selectedFinding: finding,
          selectedEvaluations: []
        })
      }
    })
  }

  /**
   * Handler that gets called when a geometry type has been selected for
   * annotation.
   *
   * @param value - Code value of the coded finding that got selected
   * @param option - Option that got selected
   */
  handleAnnotationGeometryTypeSelection (value: string, option: any): void {
    this.setState({ selectedGeometryType: value })
  }

  /**
   * Handler that gets called when measurements have been selected for
   * annotation.
   */
  handleAnnotationMeasurementActivation (event: any): void {
    const active: boolean = event.target.checked
    if (active) {
      this.setState({ selectedMarkup: 'measurement' })
    } else {
      this.setState({ selectedMarkup: undefined })
    }
  }

  /**
   * Handler that gets called when an evaluation has been selected for an
   * annotation.
   *
   * @param value - Code value of the coded evaluation that got selected
   * @param option - Option that got selected
   */
  handleAnnotationEvaluationSelection (
    value: string,
    option: any
  ): void {
    const selectedFinding = this.state.selectedFinding
    if (selectedFinding !== undefined) {
      const key = _buildKey(selectedFinding)
      const name = option.label
      this.evaluationOptions[key].forEach(evaluation => {
        if (
          evaluation.name.CodeValue === name.CodeValue &&
          evaluation.name.CodingSchemeDesignator === name.CodingSchemeDesignator
        ) {
          evaluation.values.forEach(code => {
            if (code.CodeValue === value) {
              const filteredEvaluations = this.state.selectedEvaluations.filter(
                (item: Evaluation) => item.name !== evaluation.name
              )
              this.setState({
                selectedEvaluations: [
                  ...filteredEvaluations,
                  { name: name, value: code }
                ]
              })
            }
          })
        }
      })
    }
  }

  /**
   * Handler that gets called when an evaluation has been cleared for an
   * annotation.
   */
  handleAnnotationEvaluationClearance (): void {
    this.setState({
      selectedEvaluations: []
    })
  }

  handleXCoordinateSelection (value: any): void {
    if (value != null) {
      const x = Number(value)
      const start = this.state.validXCoordinateRange[0]
      const end = this.state.validXCoordinateRange[1]
      if (x >= start && x <= end) {
        this.setState({
          selectedXCoordinate: x,
          isSelectedXCoordinateValid: true
        })
        return
      }
    }
    this.setState({
      selectedXCoordinate: undefined,
      isSelectedXCoordinateValid: false
    })
  }

  handleYCoordinateSelection (value: any): void {
    if (value != null) {
      const y = Number(value)
      const start = this.state.validYCoordinateRange[0]
      const end = this.state.validYCoordinateRange[1]
      if (y >= start && y <= end) {
        this.setState({
          selectedYCoordinate: y,
          isSelectedYCoordinateValid: true
        })
        return
      }
    }
    this.setState({
      selectedYCoordinate: undefined,
      isSelectedYCoordinateValid: false
    })
  }

  handleMagnificationSelection (value: any): void {
    if (value != null) {
      if (value > 0 && value <= 40) {
        this.setState({
          selectedMagnification: Number(value),
          isSelectedMagnificationValid: true
        })
        return
      }
    }
    this.setState({
      selectedMagnification: undefined,
      isSelectedMagnificationValid: false
    })
  }

  /**
   * Handler that gets called when the selection of slide position was
   * completed.
   */
  handleSlidePositionSelection (): void {
    if (
      this.state.isSelectedXCoordinateValid &&
      this.state.isSelectedYCoordinateValid &&
      this.state.isSelectedMagnificationValid &&
      this.state.selectedXCoordinate != null &&
      this.state.selectedYCoordinate != null &&
      this.state.selectedMagnification != null
    ) {
      console.info(
        'select slide position ' +
        `(${this.state.selectedXCoordinate}, ` +
        `${this.state.selectedYCoordinate}) ` +
        `at ${this.state.selectedMagnification}x magnification`
      )

      const factor = this.state.selectedMagnification
      /**
       * On an optical microscope an objective with 1x magnification
       * corresponds to approximately 10 micrometer pixel spacing
       * (due to the ocular).
       */
      const targetPixelSpacing = 0.01 / factor
      const diffs = []
      for (let i = 0; i < this.volumeViewer.numLevels; i++) {
        const actualPixelSpacing = this.volumeViewer.getPixelSpacing(i)[0]
        diffs.push(Math.abs(targetPixelSpacing - actualPixelSpacing))
      }
      const level = diffs.indexOf(Math.min(...diffs))
      this.volumeViewer.navigate({
        position: [
          this.state.selectedXCoordinate,
          this.state.selectedYCoordinate
        ],
        level: level
      })
      const point = new dmv.scoord3d.Point({
        coordinates: [
          this.state.selectedXCoordinate,
          this.state.selectedYCoordinate,
          0
        ],
        frameOfReferenceUID: this.volumeViewer.frameOfReferenceUID
      })
      const roi = new dmv.roi.ROI({ scoord3d: point })
      this.volumeViewer.addROI(roi, this.defaultRoiStyle)
      this.setState(state => {
        const visibleRoiUIDs = state.visibleRoiUIDs
        visibleRoiUIDs.add(roi.uid)
        return {
          visibleRoiUIDs,
          isGoToModalVisible: false
        }
      })
    }
  }

  /**
   * Handler that gets called when the selection of a slide position was
   * canceled.
   */
  handleSlidePositionSelectionCancellation (): void {
    console.log('cancel slide position selection')
    this.setState({
      isGoToModalVisible: false,
      isSelectedXCoordinateValid: false,
      isSelectedYCoordinateValid: false,
      isSelectedMagnificationValid: false,
      selectedXCoordinate: undefined,
      selectedYCoordinate: undefined,
      selectedMagnification: undefined
    })
  }

  /**
   * Handler that gets called when annotation configuration has been completed.
   */
  handleAnnotationConfigurationCompletion (): void {
    console.debug('complete annotation configuration')
    const finding = this.state.selectedFinding
    const geometryType = this.state.selectedGeometryType
    const markup = this.state.selectedMarkup
    if (geometryType !== undefined && finding !== undefined) {
      this.volumeViewer.activateDrawInteraction({ geometryType, markup })
      this.setState({
        isAnnotationModalVisible: false,
        isRoiDrawingActive: true
      })
    } else {
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Could not complete annotation configuration'
        )
      )
    }
  }

  /**
   * Handler that gets called when annotation configuration has been cancelled.
   */
  handleAnnotationConfigurationCancellation (): void {
    console.debug('cancel annotation configuration')
    this.setState({
      isAnnotationModalVisible: false,
      isRoiDrawingActive: false
    })
  }

  /**
   * Handler that gets called when a report should be generated for the current
   * set of annotations.
   */
  handleReportGeneration (): void {
    console.info('save ROIs')
    const rois = this.volumeViewer.getAllROIs()
    const opticalPaths = this.volumeViewer.getAllOpticalPaths()
    const metadata = this.volumeViewer.getOpticalPathMetadata(
      opticalPaths[0].identifier
    )
    // Metadata should be sorted such that the image with the highest
    // resolution is the last item in the array.
    const refImage = metadata[metadata.length - 1]
    // We assume that there is only one specimen (tissue section) per
    // ontainer (slide). Only the tissue section is tracked with a unique
    // identifier, even if the section may be composed of different biological
    // samples.
    if (refImage.SpecimenDescriptionSequence.length > 1) {
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'More than one specimen has been described for the slide'
        )
      )
    }
    const refSpecimen = refImage.SpecimenDescriptionSequence[0]

    console.debug('create Observation Context')
    let observer
    if (this.props.user !== undefined) {
      observer = new dcmjs.sr.templates.PersonObserverIdentifyingAttributes({
        name: this.props.user.name,
        loginName: this.props.user.email
      })
    } else {
      console.warn('no user information available')
      observer = new dcmjs.sr.templates.PersonObserverIdentifyingAttributes({
        name: 'ANONYMOUS'
      })
    }
    const observationContext = new dcmjs.sr.templates.ObservationContext({
      observerPersonContext: new dcmjs.sr.templates.ObserverContext({
        observerType: new dcmjs.sr.coding.CodedConcept({
          value: '121006',
          schemeDesignator: 'DCM',
          meaning: 'Person'
        }),
        observerIdentifyingAttributes: observer
      }),
      observerDeviceContext: new dcmjs.sr.templates.ObserverContext({
        observerType: new dcmjs.sr.coding.CodedConcept({
          value: '121007',
          schemeDesignator: 'DCM',
          meaning: 'Device'
        }),
        observerIdentifyingAttributes:
          new dcmjs.sr.templates.DeviceObserverIdentifyingAttributes({
            uid: this.props.app.uid,
            manufacturerName: 'MGH Computational Pathology',
            modelName: this.props.app.name
          })
      }),
      subjectContext: new dcmjs.sr.templates.SubjectContext({
        subjectClass: new dcmjs.sr.coding.CodedConcept({
          value: '121027',
          schemeDesignator: 'DCM',
          meaning: 'Specimen'
        }),
        subjectClassSpecificContext:
          new dcmjs.sr.templates.SubjectContextSpecimen({
            uid: refSpecimen.SpecimenUID,
            identifier: refSpecimen.SpecimenIdentifier,
            containerIdentifier: refImage.ContainerIdentifier
          })
      })
    })

    console.debug('encode Imaging Measurements')
    const imagingMeasurements: dcmjs.sr.valueTypes.ContainerContentItem[] = []
    for (let i = 0; i < rois.length; i++) {
      const roi = rois[i]
      if (!this.state.visibleRoiUIDs.has(roi.uid)) {
        continue
      }
      let findingType = roi.evaluations.find(
        (item: dcmjs.sr.valueTypes.ContentItem) => {
          return item.ConceptNameCodeSequence[0].CodeValue === '121071'
        }
      )
      if (findingType === undefined) {
        NotificationMiddleware.onError(
          NotificationMiddlewareContext.SLIM,
          new CustomError(
            errorTypes.ENCODINGANDDECODING,
            `No finding type was specified for ROI "${roi.uid}"`
          )
        )
      }
      findingType = findingType as dcmjs.sr.valueTypes.CodeContentItem
      const group = new dcmjs.sr.templates.PlanarROIMeasurementsAndQualitativeEvaluations({
        trackingIdentifier: new dcmjs.sr.templates.TrackingIdentifier({
          uid: roi.properties.trackingUID ?? roi.uid,
          identifier: `ROI #${i + 1}`
        }),
        referencedRegion: new dcmjs.sr.contentItems.ImageRegion3D({
          graphicType: roi.scoord3d.graphicType,
          graphicData: roi.scoord3d.graphicData,
          frameOfReferenceUID: roi.scoord3d.frameOfReferenceUID
        }),
        findingType: new dcmjs.sr.coding.CodedConcept({
          value: findingType.ConceptCodeSequence[0].CodeValue,
          schemeDesignator:
            findingType.ConceptCodeSequence[0].CodingSchemeDesignator,
          meaning: findingType.ConceptCodeSequence[0].CodeMeaning
        }),
        qualitativeEvaluations: roi.evaluations.filter(
          (item: dcmjs.sr.valueTypes.ContentItem) => {
            return item.ConceptNameCodeSequence[0].CodeValue !== '121071'
          }
        ),
        measurements: roi.measurements
      })
      const measurements = group as dcmjs.sr.valueTypes.ContainerContentItem[]
      measurements[0].ContentTemplateSequence = [{
        MappingResource: 'DCMR',
        TemplateIdentifier: '1410'
      }]
      imagingMeasurements.push(...measurements)
    }

    console.debug('create Measurement Report document content')
    const measurementReport = new dcmjs.sr.templates.MeasurementReport({
      languageOfContentItemAndDescendants: new dcmjs.sr.templates.LanguageOfContentItemAndDescendants({}),
      observationContext: observationContext,
      procedureReported: new dcmjs.sr.coding.CodedConcept({
        value: '112703',
        schemeDesignator: 'DCM',
        meaning: 'Whole Slide Imaging'
      }),
      imagingMeasurements: imagingMeasurements
    })

    console.info('create Comprehensive 3D SR document')
    const dataset = new dcmjs.sr.documents.Comprehensive3DSR({
      content: measurementReport[0],
      evidence: [refImage],
      seriesInstanceUID: dcmjs.data.DicomMetaDictionary.uid(),
      seriesNumber: 1,
      seriesDescription: 'Annotation',
      sopInstanceUID: dcmjs.data.DicomMetaDictionary.uid(),
      instanceNumber: 1,
      manufacturer: 'MGH Computational Pathology',
      previousVersions: undefined // TODO
    })

    this.setState({
      isReportModalVisible: true,
      generatedReport: dataset as dmv.metadata.Comprehensive3DSR
    })
  }

  /**
   * Handler that gets called when a report should be verified. The current
   * list of annotations will be presented to the user together with other
   * pertinent metadata about the patient, study, and specimen.
   */
  handleReportVerification (): void {
    console.info('verfied report')

    const report = this.state.generatedReport
    if (report !== undefined) {
      const dataset = report as unknown as dmv.metadata.Comprehensive3DSR
      console.debug('create File Meta Information')
      const fileMetaInformationVersionArray = new Uint8Array(2)
      fileMetaInformationVersionArray[1] = 1
      const fileMeta = {
        // FileMetaInformationVersion
        '00020001': {
          Value: [fileMetaInformationVersionArray.buffer],
          vr: 'OB'
        },
        // MediaStorageSOPClassUID
        '00020002': {
          Value: [dataset.SOPClassUID],
          vr: 'UI'
        },
        // MediaStorageSOPInstanceUID
        '00020003': {
          Value: [dataset.SOPInstanceUID],
          vr: 'UI'
        },
        // TransferSyntaxUID
        '00020010': {
          Value: ['1.2.840.10008.1.2.1'],
          vr: 'UI'
        },
        // ImplementationClassUID
        '00020012': {
          Value: [this.props.app.uid],
          vr: 'UI'
        }
      }

      console.info('store Comprehensive 3D SR document')
      const writer = new dcmjs.data.DicomDict(fileMeta)
      writer.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset)
      const buffer = writer.write()
      const client = this.props.clients[StorageClasses.COMPREHENSIVE_3D_SR]
      client.storeInstances({ datasets: [buffer] }).then(
        (response: any) => message.info('Annotations were saved.')
      ).catch((error) => {
        console.error(error)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        NotificationMiddleware.onError(
          NotificationMiddlewareContext.SLIM,
          new CustomError(
            errorTypes.ENCODINGANDDECODING,
            'Annotations could not be saved'
          )
        )
      })
    }
    this.setState({
      isReportModalVisible: false,
      generatedReport: undefined
    })
  }

  /**
   * Handler that gets called when report generation has been cancelled.
   */
  handleReportCancellation (): void {
    this.setState({
      isReportModalVisible: false,
      generatedReport: undefined
    })
  }

  /**
   * Handler that gets called when an annotation has been selected from the
   * current list of annotations.
   */
  handleAnnotationSelection ({ roiUID }: { roiUID: string }): void {
    console.log(`selected ROI ${roiUID}`)
    this.setState({ selectedRoiUIDs: new Set([roiUID]) })
    this.volumeViewer.getAllROIs().forEach((roi) => {
      let style = {}
      if (roi.uid === roiUID) {
        style = this.selectedRoiStyle
        this.setState(state => {
          const visibleRoiUIDs = state.visibleRoiUIDs
          visibleRoiUIDs.add(roi.uid)
          return { visibleRoiUIDs }
        })
      } else {
        if (this.state.visibleRoiUIDs.has(roi.uid)) {
          const key = _getRoiKey(roi)
          style = this.getRoiStyle(key)
        }
      }
      this.volumeViewer.setROIStyle(roi.uid, style)
    })
  }

  /**
   * Handle toggling of annotation visibility, i.e., whether a given
   * annotation should be either displayed or hidden by the viewer.
   */
  handleAnnotationVisibilityChange ({ roiUID, isVisible }: {
    roiUID: string
    isVisible: boolean
  }): void {
    if (isVisible) {
      console.info(`show ROI ${roiUID}`)
      const roi = this.volumeViewer.getROI(roiUID)
      const key = _getRoiKey(roi)
      this.volumeViewer.setROIStyle(roi.uid, this.getRoiStyle(key))
      this.setState(state => {
        const visibleRoiUIDs = state.visibleRoiUIDs
        visibleRoiUIDs.add(roi.uid)
        return { visibleRoiUIDs }
      })
    } else {
      console.info(`hide ROI ${roiUID}`)
      this.setState(state => {
        const selectedRoiUIDs = state.selectedRoiUIDs
        selectedRoiUIDs.delete(roiUID)
        const visibleRoiUIDs = state.visibleRoiUIDs
        visibleRoiUIDs.delete(roiUID)
        return { visibleRoiUIDs, selectedRoiUIDs }
      })
      this.volumeViewer.setROIStyle(roiUID, {})
    }
  }

  /**
   * Handle toggling of annotation group visibility, i.e., whether a given
   * annotation group should be either displayed or hidden by the viewer.
   */
  handleAnnotationGroupVisibilityChange ({ annotationGroupUID, isVisible }: {
    annotationGroupUID: string
    isVisible: boolean
  }): void {
    console.log(`change visibility of annotation group ${annotationGroupUID}`)
    if (isVisible) {
      console.info(`show annotation group ${annotationGroupUID}`)
      try {
        this.volumeViewer.showAnnotationGroup(annotationGroupUID)
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        NotificationMiddleware.onError(
          NotificationMiddlewareContext.SLIM,
          new CustomError(
            errorTypes.VISUALIZATION,
            'Failed to show annotation group.'
          )
        )
        throw error
      }
      this.setState(state => {
        const visibleAnnotationGroupUIDs = new Set(
          state.visibleAnnotationGroupUIDs
        )
        visibleAnnotationGroupUIDs.add(annotationGroupUID)
        return { visibleAnnotationGroupUIDs }
      })
    } else {
      console.info(`hide annotation group ${annotationGroupUID}`)
      this.volumeViewer.hideAnnotationGroup(annotationGroupUID)
      this.setState(state => {
        const visibleAnnotationGroupUIDs = new Set(
          state.visibleAnnotationGroupUIDs
        )
        visibleAnnotationGroupUIDs.delete(annotationGroupUID)
        return { visibleAnnotationGroupUIDs }
      })
    }
  }

  /**
   * Handle change of annotation group style.
   */
  handleAnnotationGroupStyleChange ({ annotationGroupUID, styleOptions }: {
    annotationGroupUID: string
    styleOptions: {
      opacity?: number
      color?: number[]
      measurement?: dcmjs.sr.coding.CodedConcept
    }
  }): void {
    console.log(`change style of annotation group ${annotationGroupUID}`)
    try {
      this.volumeViewer.setAnnotationGroupStyle(
        annotationGroupUID,
        styleOptions
      )
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      NotificationMiddleware.onError(
        NotificationMiddlewareContext.SLIM,
        new CustomError(
          errorTypes.VISUALIZATION,
          'Failed to change style of annotation group.'
        )
      )
      throw error
    }
  }

  /**
   * Handle toggling of segment visibility, i.e., whether a given
   * segment should be either displayed or hidden by the viewer.
   */
  handleSegmentVisibilityChange ({ segmentUID, isVisible }: {
    segmentUID: string
    isVisible: boolean
  }): void {
    console.log(`change visibility of segment ${segmentUID}`)
    if (isVisible) {
      console.info(`show segment ${segmentUID}`)
      this.volumeViewer.showSegment(segmentUID)
      this.setState(state => {
        const visibleSegmentUIDs = new Set(state.visibleSegmentUIDs)
        visibleSegmentUIDs.add(segmentUID)
        return { visibleSegmentUIDs }
      })
    } else {
      console.info(`hide segment ${segmentUID}`)
      this.volumeViewer.hideSegment(segmentUID)
      this.setState(state => {
        const visibleSegmentUIDs = new Set(state.visibleSegmentUIDs)
        visibleSegmentUIDs.delete(segmentUID)
        return { visibleSegmentUIDs }
      })
    }
  }

  /**
   * Handle change of segment style.
   */
  handleSegmentStyleChange ({ segmentUID, styleOptions }: {
    segmentUID: string
    styleOptions: {
      opacity?: number
    }
  }): void {
    console.log(`change style of segment ${segmentUID}`)
    this.volumeViewer.setSegmentStyle(segmentUID, styleOptions)
  }

  /**
   * Handle toggling of mapping visibility, i.e., whether a given
   * mapping should be either displayed or hidden by the viewer.
   */
  handleMappingVisibilityChange ({ mappingUID, isVisible }: {
    mappingUID: string
    isVisible: boolean
  }): void {
    console.log(`change visibility of mapping ${mappingUID}`)
    if (isVisible) {
      console.info(`show mapping ${mappingUID}`)
      this.volumeViewer.showParameterMapping(mappingUID)
      this.setState(state => {
        const visibleMappingUIDs = new Set(state.visibleMappingUIDs)
        visibleMappingUIDs.add(mappingUID)
        return { visibleMappingUIDs }
      })
    } else {
      console.info(`hide mapping ${mappingUID}`)
      this.volumeViewer.hideParameterMapping(mappingUID)
      this.setState(state => {
        const visibleMappingUIDs = new Set(state.visibleMappingUIDs)
        visibleMappingUIDs.delete(mappingUID)
        return { visibleMappingUIDs }
      })
    }
  }

  /**
   * Handle change of mapping style.
   */
  handleMappingStyleChange ({ mappingUID, styleOptions }: {
    mappingUID: string
    styleOptions: {
      opacity?: number
    }
  }): void {
    console.log(`change style of mapping ${mappingUID}`)
    this.volumeViewer.setParameterMappingStyle(mappingUID, styleOptions)
  }

  /**
   * Handle toggling of optical path visibility, i.e., whether a given
   * optical path should be either displayed or hidden by the viewer.
   */
  handleOpticalPathVisibilityChange ({ opticalPathIdentifier, isVisible }: {
    opticalPathIdentifier: string
    isVisible: boolean
  }): void {
    console.log(`change visibility of optical path ${opticalPathIdentifier}`)
    if (isVisible) {
      console.info(`show optical path ${opticalPathIdentifier}`)
      this.volumeViewer.showOpticalPath(opticalPathIdentifier)
      this.setState(state => {
        const visibleOpticalPathIdentifiers = new Set(
          state.visibleOpticalPathIdentifiers
        )
        visibleOpticalPathIdentifiers.add(opticalPathIdentifier)
        return { visibleOpticalPathIdentifiers }
      })
    } else {
      console.info(`hide optical path ${opticalPathIdentifier}`)
      this.volumeViewer.hideOpticalPath(opticalPathIdentifier)
      this.setState(state => {
        const visibleOpticalPathIdentifiers = new Set(
          state.visibleOpticalPathIdentifiers
        )
        visibleOpticalPathIdentifiers.delete(opticalPathIdentifier)
        return { visibleOpticalPathIdentifiers }
      })
    }
  }

  /**
   * Handle change of optical path style.
   */
  handleOpticalPathStyleChange ({ opticalPathIdentifier, styleOptions }: {
    opticalPathIdentifier: string
    styleOptions: {
      opacity?: number
      color?: number[]
      limitValues?: number[]
    }
  }): void {
    console.log(`change style of optical path ${opticalPathIdentifier}`)
    this.volumeViewer.setOpticalPathStyle(opticalPathIdentifier, styleOptions)
  }

  /**
   * Handle toggling of optical path activity, i.e., whether a given
   * optical path should be either added or removed from the viewport.
   */
  handleOpticalPathActivityChange ({ opticalPathIdentifier, isActive }: {
    opticalPathIdentifier: string
    isActive: boolean
  }): void {
    console.log(`change activity of optical path ${opticalPathIdentifier}`)
    if (isActive) {
      console.info(`activate optical path ${opticalPathIdentifier}`)
      this.volumeViewer.activateOpticalPath(opticalPathIdentifier)
      this.setState(state => {
        const activeOpticalPathIdentifiers = new Set(
          state.activeOpticalPathIdentifiers
        )
        activeOpticalPathIdentifiers.add(opticalPathIdentifier)
        return { activeOpticalPathIdentifiers }
      })
    } else {
      console.info(`deactivate optical path ${opticalPathIdentifier}`)
      this.volumeViewer.deactivateOpticalPath(opticalPathIdentifier)
      this.setState(state => {
        const activeOpticalPathIdentifiers = new Set(
          state.activeOpticalPathIdentifiers
        )
        activeOpticalPathIdentifiers.delete(opticalPathIdentifier)
        return { activeOpticalPathIdentifiers }
      })
    }
  }

  /**
   * Set default presentation state that is either defined by metadata included
   * in the DICOM Slide Microscopy instance or by the viewer.
   */
  setDefaultPresentationState (): void {
    const visibleOpticalPathIdentifiers: Set<string> = new Set()
    const opticalPaths = this.volumeViewer.getAllOpticalPaths()
    opticalPaths.sort((a, b) => {
      if (a.identifier.localeCompare(b.identifier) === 1) {
        return 1
      } else if (b.identifier.localeCompare(a.identifier) === 1) {
        return -1
      }
      return 0
    })
    opticalPaths.forEach((item: dmv.opticalPath.OpticalPath) => {
      const identifier = item.identifier
      const style = this.volumeViewer.getOpticalPathDefaultStyle(identifier)
      this.volumeViewer.setOpticalPathStyle(identifier, style)
      this.volumeViewer.hideOpticalPath(identifier)
      this.volumeViewer.deactivateOpticalPath(identifier)
      if (item.isMonochromatic) {
        /*
         * If the image metadata contains a palette color lookup table for the
         * optical path, then it will be displayed by default.
         */
        if (item.paletteColorLookupTableUID != null) {
          visibleOpticalPathIdentifiers.add(identifier)
        }
      } else {
        /* Color images will always be displayed by default. */
        visibleOpticalPathIdentifiers.add(identifier)
      }
    })

    /*
     * If no optical paths have been selected for visualization so far, select
     * first n optical paths and set a default value of interest (VOI) window
     * (using pre-computed pixel data statistics) and a default color.
     */
    if (visibleOpticalPathIdentifiers.size === 0) {
      const defaultColors = [
        [255, 255, 255]
      ]
      opticalPaths.forEach((item: dmv.opticalPath.OpticalPath) => {
        const identifier = item.identifier
        if (item.isMonochromatic) {
          const numVisible = visibleOpticalPathIdentifiers.size
          if (numVisible < defaultColors.length) {
            const style = {
              ...this.volumeViewer.getOpticalPathStyle(identifier)
            }
            const index = numVisible
            style.color = defaultColors[index]
            const stats = this.state.pixelDataStatistics[item.identifier]
            if (stats != null) {
              style.limitValues = [stats.min, stats.max]
            }
            this.volumeViewer.setOpticalPathStyle(item.identifier, style)
            visibleOpticalPathIdentifiers.add(item.identifier)
          }
        }
      })
    }

    console.info(
      `selected n=${visibleOpticalPathIdentifiers.size} optical paths ` +
      'for visualization'
    )
    visibleOpticalPathIdentifiers.forEach(identifier => {
      this.volumeViewer.showOpticalPath(identifier)
    })
    this.setState(state => ({
      activeOpticalPathIdentifiers: new Set(visibleOpticalPathIdentifiers),
      visibleOpticalPathIdentifiers: new Set(visibleOpticalPathIdentifiers)
    }))
  }

  /**
   * Handler that gets called when a presentation state has been selected from
   * the current list of available presentation states.
   */
  handlePresentationStateReset (): void {
    this.setState({ selectedPresentationStateUID: undefined })
    const urlPath = this.props.location.pathname
    this.props.navigate(urlPath)
    this.setDefaultPresentationState()
  }

  /**
   * Handler that gets called when a presentation state has been selected from
   * the current list of available presentation states.
   */
  handlePresentationStateSelection (
    value?: string,
    option?: any
  ): void {
    if (value != null) {
      console.info(`select Presentation State instance "${value}"`)
      let presentationState
      this.state.presentationStates.forEach(instance => {
        if (instance.SOPInstanceUID === value) {
          presentationState = instance
        }
      })
      if (presentationState != null) {
        let urlPath = this.props.location.pathname
        urlPath += `?state=${value}`
        this.props.navigate(urlPath)
        this.setPresentationState(presentationState)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        NotificationMiddleware.onError(
          NotificationMiddlewareContext.SLIM,
          new CustomError(
            errorTypes.VISUALIZATION,
            'Presentation State could not be found'
          )
        )
        console.log(
          'failed to handle section of presentation state: ' +
          `could not find instance "${value}"`
        )
      }
    } else {
      this.handlePresentationStateReset()
    }
    this.setState({ selectedPresentationStateUID: value })
  }

  /**
   * Handler that will toggle the ROI drawing tool, i.e., either activate or
   * de-activate it, depending on its current state.
   */
  handleRoiDrawing (): void {
    if (this.state.isRoiDrawingActive) {
      console.info('deactivate drawing of ROIs')
      this.volumeViewer.deactivateDrawInteraction()
      this.volumeViewer.activateSelectInteraction({})
      this.setState({
        isAnnotationModalVisible: false,
        isSelectedRoiModalVisible: false,
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false,
        isGoToModalVisible: false
      })
    } else {
      console.info('activate drawing of ROIs')
      this.setState({
        isAnnotationModalVisible: true,
        isSelectedRoiModalVisible: false,
        isRoiDrawingActive: true,
        isRoiModificationActive: false,
        isRoiTranslationActive: false,
        isGoToModalVisible: false
      })
      this.volumeViewer.deactivateSelectInteraction()
      this.volumeViewer.deactivateSnapInteraction()
      this.volumeViewer.deactivateTranslateInteraction()
      this.volumeViewer.deactivateModifyInteraction()
    }
  }

  /**
   * Handler that will toggle the ROI modification tool, i.e., either activate
   * or de-activate it, depending on its current state.
   */
  handleRoiModification (): void {
    console.info('toggle modification of ROIs')
    if (this.volumeViewer.isModifyInteractionActive) {
      this.volumeViewer.deactivateModifyInteraction()
      this.volumeViewer.deactivateSnapInteraction()
      this.volumeViewer.activateSelectInteraction({})
      this.setState({
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false
      })
    } else {
      this.setState({
        isRoiModificationActive: true,
        isRoiDrawingActive: false,
        isRoiTranslationActive: false
      })
      this.volumeViewer.deactivateDrawInteraction()
      this.volumeViewer.deactivateTranslateInteraction()
      this.volumeViewer.deactivateSelectInteraction()
      this.volumeViewer.activateSnapInteraction({})
      this.volumeViewer.activateModifyInteraction({})
    }
  }

  /**
   * Handler that will toggle the ROI translation tool, i.e., either activate
   * or de-activate it, depending on its current state.
   */
  handleRoiTranslation (): void {
    console.info('toggle translation of ROIs')
    if (this.volumeViewer.isTranslateInteractionActive) {
      this.volumeViewer.deactivateTranslateInteraction()
      this.setState({
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false
      })
    } else {
      this.setState({
        isRoiTranslationActive: true,
        isRoiDrawingActive: false,
        isRoiModificationActive: false
      })
      this.volumeViewer.deactivateModifyInteraction()
      this.volumeViewer.deactivateSnapInteraction()
      this.volumeViewer.deactivateDrawInteraction()
      this.volumeViewer.deactivateSelectInteraction()
      this.volumeViewer.activateTranslateInteraction({})
    }
  }

  handleGoTo (): void {
    this.volumeViewer.deactivateDrawInteraction()
    this.volumeViewer.deactivateModifyInteraction()
    this.volumeViewer.deactivateSnapInteraction()
    this.volumeViewer.deactivateTranslateInteraction()
    this.volumeViewer.deactivateSelectInteraction()
    this.setState({
      isGoToModalVisible: true,
      isAnnotationModalVisible: false,
      isSelectedRoiModalVisible: false,
      isReportModalVisible: false,
      isRoiTranslationActive: false,
      isRoiModificationActive: false,
      isRoiDrawingActive: false
    })
  }

  /**
   * Handler that will toggle the ROI removal tool, i.e., either activate
   * or de-activate it, depending on its current state.
   */
  handleRoiRemoval (): void {
    this.volumeViewer.deactivateDrawInteraction()
    this.volumeViewer.deactivateSnapInteraction()
    this.volumeViewer.deactivateTranslateInteraction()
    this.volumeViewer.deactivateModifyInteraction()
    if (this.state.selectedRoiUIDs.size > 0) {
      this.state.selectedRoiUIDs.forEach(uid => {
        if (uid === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          message.warning('No annotation was selected for removal')
          return
        }
        console.info(`remove ROI "${uid}"`)
        this.volumeViewer.removeROI(uid)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        message.info('Annotation was removed')
      })
      this.setState({
        selectedRoiUIDs: new Set(),
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false
      })
    } else {
      this.state.visibleRoiUIDs.forEach(uid => {
        console.info(`remove ROI "${uid}"`)
        this.volumeViewer.removeROI(uid)
      })
      this.setState({
        visibleRoiUIDs: new Set(),
        isRoiTranslationActive: false,
        isRoiDrawingActive: false,
        isRoiModificationActive: false
      })
    }
    this.volumeViewer.activateSelectInteraction({})
  }

  /**
   * Handler that will toggle the ROI visibility tool, i.e., either activate
   * or de-activate it, depending on its current state.
   */
  handleRoiVisibilityChange (): void {
    console.info('toggle visibility of ROIs')
    if (this.volumeViewer.areROIsVisible) {
      this.volumeViewer.deactivateDrawInteraction()
      this.volumeViewer.deactivateSnapInteraction()
      this.volumeViewer.deactivateTranslateInteraction()
      this.volumeViewer.deactivateSelectInteraction()
      this.volumeViewer.deactivateModifyInteraction()
      this.volumeViewer.hideROIs()
      this.setState({
        areRoisHidden: true,
        isRoiDrawingActive: false,
        isRoiModificationActive: false,
        isRoiTranslationActive: false
      })
    } else {
      this.volumeViewer.showROIs()
      this.volumeViewer.activateSelectInteraction({})
      this.state.selectedRoiUIDs.forEach(uid => {
        if (uid !== undefined) {
          this.volumeViewer.setROIStyle(uid, this.selectedRoiStyle)
        }
      })
      this.setState({ areRoisHidden: false })
    }
  }

  render (): React.ReactNode {
    const rois: dmv.roi.ROI[] = []
    const segments: dmv.segment.Segment[] = []
    const mappings: dmv.mapping.ParameterMapping[] = []
    const annotationGroups: dmv.annotation.AnnotationGroup[] = []
    rois.push(...this.volumeViewer.getAllROIs())
    segments.push(...this.volumeViewer.getAllSegments())
    mappings.push(...this.volumeViewer.getAllParameterMappings())
    const allAnnotationGroups = this.volumeViewer.getAllAnnotationGroups()
    const filteredAnnotationGroups = allAnnotationGroups?.filter((annotationGroup) =>
      annotationGroup.referencedSeriesInstanceUID === this.props.seriesInstanceUID
    )
    annotationGroups.push(...filteredAnnotationGroups)

    const openSubMenuItems = [
      'specimens', 'optical-paths', 'annotations', 'presentation-states'
    ]

    let report: React.ReactNode
    const dataset = this.state.generatedReport
    if (dataset !== undefined) {
      report = <Report dataset={dataset} />
    }

    let annotationMenuItems: React.ReactNode
    if (rois.length > 0) {
      annotationMenuItems = (
        <AnnotationList
          rois={rois}
          selectedRoiUIDs={this.state.selectedRoiUIDs}
          visibleRoiUIDs={this.state.visibleRoiUIDs}
          onSelection={this.handleAnnotationSelection}
          onVisibilityChange={this.handleAnnotationVisibilityChange}
        />
      )
    }

    const findingOptions = this.findingOptions.map(finding => {
      return (
        <Select.Option
          key={finding.CodeValue}
          value={finding.CodeValue}
        >
          {finding.CodeMeaning}
        </Select.Option>
      )
    })

    const geometryTypeOptionsMapping: { [key: string]: React.ReactNode } = {
      point: <Select.Option key='point' value='point'>Point</Select.Option>,
      circle: <Select.Option key='circle' value='circle'>Circle</Select.Option>,
      box: <Select.Option key='box' value='box'>Box</Select.Option>,
      polygon: <Select.Option key='polygon' value='polygon'>Polygon</Select.Option>,
      line: <Select.Option key='line' value='line'>Line</Select.Option>,
      freehandpolygon: (
        <Select.Option key='freehandpolygon' value='freehandpolygon'>
          Polygon (freehand)
        </Select.Option>
      ),
      freehandline: (
        <Select.Option key='freehandline' value='freehandline'>
          Line (freehand)
        </Select.Option>
      )
    }

    const annotationConfigurations: React.ReactNode[] = [
      (
        <Select
          style={{ minWidth: 130 }}
          onSelect={this.handleAnnotationFindingSelection}
          key='annotation-finding'
          defaultActiveFirstOption
        >
          {findingOptions}
        </Select>
      )
    ]

    const selectedFinding = this.state.selectedFinding
    if (selectedFinding !== undefined) {
      const key = _buildKey(selectedFinding)
      this.evaluationOptions[key].forEach(evaluation => {
        const evaluationOptions = evaluation.values.map(code => {
          return (
            <Select.Option
              key={code.CodeValue}
              value={code.CodeValue}
              label={evaluation.name}
            >
              {code.CodeMeaning}
            </Select.Option>
          )
        })
        annotationConfigurations.push(
          <>
            {evaluation.name.CodeMeaning}
            <Select
              style={{ minWidth: 130 }}
              onSelect={this.handleAnnotationEvaluationSelection}
              allowClear
              onClear={this.handleAnnotationEvaluationClearance}
              defaultActiveFirstOption={false}
            >
              {evaluationOptions}
            </Select>
          </>
        )
      })
      const geometryTypeOptions = this.geometryTypeOptions[key].map(name => {
        return geometryTypeOptionsMapping[name]
      })
      annotationConfigurations.push(
        <>
          ROI geometry type
          <Select
            style={{ minWidth: 130 }}
            onSelect={this.handleAnnotationGeometryTypeSelection}
            key='annotation-geometry-type'
          >
            {geometryTypeOptions}
          </Select>
        </>
      )
      annotationConfigurations.push(
        <Checkbox
          onChange={this.handleAnnotationMeasurementActivation}
          key='annotation-measurement'
        >
          measure
        </Checkbox>
      )
    }

    const specimenMenu = (
      <Menu.SubMenu key='specimens' title='Specimens'>
        <SpecimenList
          metadata={this.props.slide.volumeImages[0]}
          showstain={false}
        />
      </Menu.SubMenu>
    )

    const equipmentMenu = (
      <Menu.SubMenu key='equipment' title='Equipment'>
        <Equipment metadata={this.props.slide.volumeImages[0]} />
      </Menu.SubMenu>
    )

    const opticalPaths = this.volumeViewer.getAllOpticalPaths()
    opticalPaths.sort((a, b) => {
      if (a.identifier.localeCompare(b.identifier) === 1) {
        return 1
      } else if (b.identifier.localeCompare(a.identifier) === 1) {
        return -1
      }
      return 0
    })
    const opticalPathStyles: {
      [identifier: string]: {
        opacity: number
        color?: number[]
        limitValues?: number[]
        paletteColorLookupTable?: dmv.color.PaletteColorLookupTable
      }
    } = {}
    const opticalPathMetadata: {
      [identifier: string]: dmv.metadata.VLWholeSlideMicroscopyImage[]
    } = {}
    opticalPaths.forEach(opticalPath => {
      const identifier = opticalPath.identifier
      const metadata = this.volumeViewer.getOpticalPathMetadata(identifier)
      opticalPathMetadata[identifier] = metadata
      const style = {
        ...this.volumeViewer.getOpticalPathStyle(identifier)
      }
      opticalPathStyles[identifier] = style
    })
    const opticalPathMenu = (
      <Menu.SubMenu key='optical-paths' title='Optical Paths'>
        <OpticalPathList
          metadata={opticalPathMetadata}
          opticalPaths={opticalPaths}
          defaultOpticalPathStyles={opticalPathStyles}
          visibleOpticalPathIdentifiers={this.state.visibleOpticalPathIdentifiers}
          activeOpticalPathIdentifiers={this.state.activeOpticalPathIdentifiers}
          onOpticalPathVisibilityChange={this.handleOpticalPathVisibilityChange}
          onOpticalPathStyleChange={this.handleOpticalPathStyleChange}
          onOpticalPathActivityChange={this.handleOpticalPathActivityChange}
          selectedPresentationStateUID={this.state.selectedPresentationStateUID}
        />
      </Menu.SubMenu>
    )

    let presentationStateMenu
    if (this.state.presentationStates.length > 0) {
      const presentationStateOptions = []
      this.state.presentationStates.forEach(instance => {
        presentationStateOptions.push(
          <Select.Option
            key={instance.SOPInstanceUID}
            value={instance.SOPInstanceUID}
            dropdownMatchSelectWidth={false}
            size='small'
          >
            {instance.ContentDescription}
          </Select.Option>
        )
      })
      presentationStateOptions.push(
        <Select.Option
          key='default-presentation-state'
          value={null}
          dropdownMatchSelectWidth={false}
          size='small'
        >
          {}
        </Select.Option>
      )
      presentationStateMenu = (
        <Menu.SubMenu key='presentation-states' title='Presentation States'>
          <Space align='center' size={20} style={{ padding: '14px' }}>
            <Select
              style={{ minWidth: 200, maxWidth: 200 }}
              onSelect={this.handlePresentationStateSelection}
              key='presentation-states'
              value={this.state.selectedPresentationStateUID}
            >
              {presentationStateOptions}
            </Select>
            <Tooltip title='Reset'>
              <Btn
                icon={<UndoOutlined />}
                type='primary'
                onClick={this.handlePresentationStateReset}
              />
            </Tooltip>
          </Space>
        </Menu.SubMenu>
      )
    }

    let segmentationMenu
    if (segments.length > 0) {
      const defaultSegmentStyles: {
        [segmentUID: string]: {
          opacity: number
        }
      } = {}
      const segmentMetadata: {
        [segmentUID: string]: dmv.metadata.Segmentation[]
      } = {}
      const segments = this.volumeViewer.getAllSegments()
      segments.forEach(segment => {
        defaultSegmentStyles[segment.uid] = this.volumeViewer.getSegmentStyle(
          segment.uid
        )
        segmentMetadata[segment.uid] = this.volumeViewer.getSegmentMetadata(
          segment.uid
        )
      })
      segmentationMenu = (
        <Menu.SubMenu key='segmentations' title='Segmentations'>
          <SegmentList
            segments={segments}
            metadata={segmentMetadata}
            defaultSegmentStyles={defaultSegmentStyles}
            visibleSegmentUIDs={this.state.visibleSegmentUIDs}
            onSegmentVisibilityChange={this.handleSegmentVisibilityChange}
            onSegmentStyleChange={this.handleSegmentStyleChange}
          />
        </Menu.SubMenu>
      )
      openSubMenuItems.push('segmentations')
    }

    let parametricMapMenu
    if (mappings.length > 0) {
      const defaultMappingStyles: {
        [mappingUID: string]: {
          opacity: number
        }
      } = {}
      const mappingMetadata: {
        [mappingUID: string]: dmv.metadata.ParametricMap[]
      } = {}
      mappings.forEach(mapping => {
        defaultMappingStyles[mapping.uid] = this.volumeViewer.getParameterMappingStyle(
          mapping.uid
        )
        mappingMetadata[mapping.uid] = this.volumeViewer.getParameterMappingMetadata(
          mapping.uid
        )
      })
      parametricMapMenu = (
        <Menu.SubMenu key='parmetric-maps' title='Parametric Maps'>
          <MappingList
            mappings={mappings}
            metadata={mappingMetadata}
            defaultMappingStyles={defaultMappingStyles}
            visibleMappingUIDs={this.state.visibleMappingUIDs}
            onMappingVisibilityChange={this.handleMappingVisibilityChange}
            onMappingStyleChange={this.handleMappingStyleChange}
          />
        </Menu.SubMenu>
      )
      openSubMenuItems.push('parametric-maps')
    }

    let annotationGroupMenu
    const defaultAnnotationGroupStyles: {
      [annotationGroupUID: string]: {
        opacity: number
        color: number[]
      }
    } = {}
    if (annotationGroups.length > 0) {
      const annotationGroupMetadata: {
        [annotationGroupUID: string]: dmv.metadata.MicroscopyBulkSimpleAnnotations
      } = {}
      annotationGroups.forEach(annotationGroup => {
        defaultAnnotationGroupStyles[annotationGroup.uid] = this.volumeViewer.getAnnotationGroupStyle(
          annotationGroup.uid
        )
        annotationGroupMetadata[annotationGroup.uid] = this.volumeViewer.getAnnotationGroupMetadata(
          annotationGroup.uid
        )
      })
      annotationGroupMenu = (
        <Menu.SubMenu key='annotation-groups' title='Annotation Groups'>
          <AnnotationGroupList
            annotationGroups={annotationGroups}
            metadata={annotationGroupMetadata}
            defaultAnnotationGroupStyles={defaultAnnotationGroupStyles}
            visibleAnnotationGroupUIDs={this.state.visibleAnnotationGroupUIDs}
            onAnnotationGroupVisibilityChange={this.handleAnnotationGroupVisibilityChange}
            onAnnotationGroupStyleChange={this.handleAnnotationGroupStyleChange}
          />
        </Menu.SubMenu>
      )
      openSubMenuItems.push('annotationGroups')
    }

    let toolbar
    let toolbarHeight = '0px'
    const annotationTools = [
      <Button
        tooltip='Draw ROI [Alt+D]'
        icon={FaDrawPolygon}
        onClick={this.handleRoiDrawing}
        isSelected={this.state.isRoiDrawingActive}
        key='draw-roi-button'
      />,
      <Button
        tooltip='Modify ROIs [Alt+M]'
        icon={FaHandPointer}
        onClick={this.handleRoiModification}
        isSelected={this.state.isRoiModificationActive}
        key='modify-roi-button'
      />,
      <Button
        tooltip='Translate ROIs [Alt+T]'
        icon={FaHandPaper}
        onClick={this.handleRoiTranslation}
        isSelected={this.state.isRoiTranslationActive}
        key='translate-roi-button'
      />,
      <Button
        tooltip='Remove selected ROI [Alt+R]'
        onClick={this.handleRoiRemoval}
        icon={FaTrash}
        key='remove-roi-button'
      />,
      <Button
        tooltip='Show/Hide ROIs [Alt+V]'
        icon={this.state.areRoisHidden ? FaEye : FaEyeSlash}
        onClick={this.handleRoiVisibilityChange}
        isSelected={this.state.areRoisHidden}
        key='toggle-roi-visibility-button'
      />,
      <Button
        tooltip='Save ROIs [Alt+S]'
        icon={FaSave}
        onClick={this.handleReportGeneration}
        key='generate-report-button'
      />
    ]
    const controlTools = [
      <Button
        tooltip='Go to [Alt+G]'
        icon={FaCrosshairs}
        onClick={this.handleGoTo}
        key='go-to-slide-position-button'
      />
    ]
    if (this.props.enableAnnotationTools) {
      toolbar = (
        <Row justify='start'>
          {annotationTools.map((item, i) => {
            return <React.Fragment key={i}>{item}</React.Fragment>
          })}
          {controlTools.map((item, i) => {
            return <React.Fragment key={i}>{item}</React.Fragment>
          })}
        </Row>
      )
      toolbarHeight = '50px'
    }

    let cursor = 'default'
    if (this.state.isLoading) {
      cursor = 'progress'
    }

    let selectedRoiInformation
    if (this.state.selectedRoi != null) {
      const roiAttributes: Array<{
        name: string
        value: string
        unit?: string
      }> = [
        {
          name: 'UID',
          value: this.state.selectedRoi.uid
        }
      ]
      const roiScoordAttributes: Array<{
        name: string
        value: string
      }> = [
        {
          name: 'Graphic type',
          value: this.state.selectedRoi.scoord3d.graphicType
        }
      ]
      const roiEvaluationAttributes: Array<{
        name: string
        value: string
      }> = []
      this.state.selectedRoi.evaluations.forEach(item => {
        if (item.ValueType === 'CODE') {
          const codeItem = item as dcmjs.sr.valueTypes.CodeContentItem
          roiEvaluationAttributes.push({
            name: codeItem.ConceptNameCodeSequence[0].CodeMeaning,
            value: codeItem.ConceptCodeSequence[0].CodeMeaning
          })
        } else {
          const textItem = item as dcmjs.sr.valueTypes.TextContentItem
          roiEvaluationAttributes.push({
            name: textItem.ConceptNameCodeSequence[0].CodeMeaning,
            value: textItem.TextValue
          })
        }
      })
      const roiMeasurmentAttributesPerOpticalPath: {
        [identifier: string]: Array<{
          name: string
          value: string
          unit?: string
        }>
      } = {}
      this.state.selectedRoi.measurements.forEach(item => {
        let identifier = 'default'
        if (item.ContentSequence != null) {
          const refItems = findContentItemsByName({
            content: item.ContentSequence,
            name: new dcmjs.sr.coding.CodedConcept({
              value: '121112',
              meaning: 'Source of Measurement',
              schemeDesignator: 'DCM'
            })
          })
          if (refItems.length > 0) {
            identifier = (
              refItems[0]
                // @ts-expect-error
                .ReferencedSOPSequence[0]
                .ReferencedOpticalPathIdentifier
            )
          }
        }
        if (!(identifier in roiMeasurmentAttributesPerOpticalPath)) {
          roiMeasurmentAttributesPerOpticalPath[identifier] = []
        }
        const measuredValueItem = item.MeasuredValueSequence[0]
        roiMeasurmentAttributesPerOpticalPath[identifier].push({
          name: item.ConceptNameCodeSequence[0].CodeMeaning,
          value: measuredValueItem.NumericValue.toString(),
          unit: measuredValueItem.MeasurementUnitsCodeSequence[0].CodeMeaning
        })
      })
      const createRoiDescription = (
        attributes: Array<{ name: string, value: string, unit?: string }>
      ): React.ReactNode[] => {
        return attributes.map(item => {
          let value
          if (item.unit != null) {
            value = `${item.value} [${item.unit}]`
          } else {
            value = item.value
          }
          return (
            <Descriptions.Item
              key={item.name}
              label={item.name}
            >
              {value}
            </Descriptions.Item>
          )
        })
      }
      const roiDescriptions = createRoiDescription(roiAttributes)
      const roiScoordDescriptions = createRoiDescription(
        roiScoordAttributes
      )
      const roiEvaluationDescriptions = createRoiDescription(
        roiEvaluationAttributes
      )
      const roiMeasurementDescriptions = []
      for (const identifier in roiMeasurmentAttributesPerOpticalPath) {
        const descriptions = createRoiDescription(
          roiMeasurmentAttributesPerOpticalPath[identifier]
        )
        if (identifier === 'default') {
          roiMeasurementDescriptions.push(descriptions)
        } else {
          roiMeasurementDescriptions.push(
            <>
              <Divider orientation='left' orientationMargin={0} dashed plain>
                {identifier}
              </Divider>
              {descriptions}
            </>
          )
        }
      }
      selectedRoiInformation = (
        <>
          <Descriptions layout='horizontal' column={1}>
            {roiDescriptions}
          </Descriptions>
          <Divider orientation='left' orientationMargin={0}>
            Spatial coordinates
          </Divider>
          <Descriptions layout='horizontal' column={1}>
            {roiScoordDescriptions}
          </Descriptions>
          <Divider orientation='left' orientationMargin={0}>
            Evaluations
          </Divider>
          <Descriptions layout='horizontal' column={1}>
            {roiEvaluationDescriptions}
          </Descriptions>
          <Divider orientation='left' orientationMargin={0}>
            Measurements
          </Divider>
          <Descriptions layout='horizontal' column={1}>
            {roiMeasurementDescriptions}
          </Descriptions>
        </>
      )
    }

    return (
      <Layout style={{ height: '100%' }} hasSider>
        <Layout.Content style={{ height: '100%' }}>
          {toolbar}

          <div
            style={{
              height: `calc(100% - ${toolbarHeight})`,
              overflow: 'hidden',
              cursor: cursor
            }}
            ref={this.volumeViewportRef}
          />

          <Modal
            visible={this.state.isAnnotationModalVisible}
            title='Configure annotations'
            onOk={this.handleAnnotationConfigurationCompletion}
            onCancel={this.handleAnnotationConfigurationCancellation}
            okText='Select'
          >
            <Space align='start' direction='vertical'>
              {annotationConfigurations}
            </Space>
          </Modal>

          <Modal
            visible={this.state.isSelectedRoiModalVisible}
            title='Selected ROI'
            onCancel={this.handleRoiSelectionCancellation}
            maskClosable
            footer={null}
          >
            <Space align='start' direction='vertical'>
              {selectedRoiInformation}
            </Space>
          </Modal>

          <Modal
            visible={this.state.isGoToModalVisible}
            title='Go to slide position'
            onOk={this.handleSlidePositionSelection}
            onCancel={this.handleSlidePositionSelectionCancellation}
            okText='Select'
          >
            <Space align='start' direction='vertical'>
              <InputNumber
                placeholder={(
                  '[' +
                  `${this.state.validXCoordinateRange[0]}` +
                  ', ' +
                  `${this.state.validXCoordinateRange[1]}` +
                  ']'
                )}
                prefix='X Coordinate [mm]'
                onChange={this.handleXCoordinateSelection}
                onPressEnter={this.handleXCoordinateSelection}
                controls={false}
                addonAfter={
                  this.state.isSelectedXCoordinateValid
                    ? <CheckOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                    : <StopOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                }
              />
              <InputNumber
                placeholder={
                  '[' +
                  `${this.state.validYCoordinateRange[0]}` +
                  ', ' +
                  `${this.state.validYCoordinateRange[1]}` +
                  ']'
                }
                prefix='Y Coordinate [mm]'
                onChange={this.handleYCoordinateSelection}
                onPressEnter={this.handleYCoordinateSelection}
                controls={false}
                addonAfter={
                  this.state.isSelectedYCoordinateValid
                    ? <CheckOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                    : <StopOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                }
              />
              <InputNumber
                placeholder='[0 - 40]'
                prefix='Magnification'
                onChange={this.handleMagnificationSelection}
                onPressEnter={this.handleMagnificationSelection}
                controls={false}
                addonAfter={
                  this.state.isSelectedMagnificationValid
                    ? <CheckOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                    : <StopOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
                }
              />
            </Space>
          </Modal>

          <Modal
            visible={this.state.isReportModalVisible}
            title='Verify and save report'
            onOk={this.handleReportVerification}
            onCancel={this.handleReportCancellation}
            okText='Save'
          >
            {report}
          </Modal>
        </Layout.Content>

        <Layout.Sider
          width={300}
          reverseArrow
          style={{
            borderLeft: 'solid',
            borderLeftWidth: 0.25,
            overflow: 'hidden',
            background: 'none'
          }}
        >
          <Menu
            mode='inline'
            defaultOpenKeys={openSubMenuItems}
            style={{ height: '100%' }}
            inlineIndent={14}
            forceSubMenuRender
            onOpenChange={() => {
              // Give menu item time to render before updating viewer size
              setTimeout(
                () => {
                  if (this.labelViewer != null) {
                    this.labelViewer.resize()
                  }
                },
                100
              )
            }}
          >
            <Menu.SubMenu key='label' title='Slide label'>
              <Menu.Item style={{ height: '100%' }} key='image'>
                <div
                  style={{ height: '220px' }}
                  ref={this.labelViewportRef}
                />
              </Menu.Item>
            </Menu.SubMenu>
            {specimenMenu}
            {equipmentMenu}
            {opticalPathMenu}
            {presentationStateMenu}
            <Menu.SubMenu key='annotations' title='Annotations'>
              {annotationMenuItems}
            </Menu.SubMenu>
            {annotationGroupMenu}
            {annotationGroups.length === 0
              ? (
                <></>
                )
              : (
                <Menu.SubMenu
                  key='annotation-category'
                  title='Annotation Categories'
                >
                  <AnnotationCategoryList
                    annotationGroups={annotationGroups}
                    onChange={this.handleAnnotationGroupVisibilityChange}
                    checkedAnnotationGroupUids={
                    this.state.visibleAnnotationGroupUIDs
                  }
                    onStyleChange={this.handleAnnotationGroupStyleChange}
                    defaultAnnotationGroupStyles={defaultAnnotationGroupStyles}
                  />
                </Menu.SubMenu>
                )}
            {segmentationMenu}
            {parametricMapMenu}
          </Menu>
        </Layout.Sider>
        {this.state.isHoveredRoiTooltipVisible &&
        (this.state.hoveredRoiAttributes.length > 0)
          ? (
            <HoveredRoiTooltip
              xPosition={this.state.hoveredRoiTooltipX}
              yPosition={this.state.hoveredRoiTooltipY}
              attributes={this.state.hoveredRoiAttributes}
            />
            )
          : (
            <></>
            )}
      </Layout>
    )
  }
}

export default withRouter(SlideViewer)
