import React from 'react'
import { Col, Divider, InputNumber, Row, Slider } from 'antd'

interface ColorSettingsMenuProps {
  annotationGroupsUIDs: string[]
  defaultStyle: {
    opacity: number
    color: number[]
  }
  onStyleChange: Function
}

interface ColorSettingsMenuState {
  currentStyle: {
    opacity: number
    color?: number[]
  }
}

/**
 * React component representing an Annotation Group.
 */
class ColorSettingsMenu extends React.Component<
ColorSettingsMenuProps,
ColorSettingsMenuState
> {
  constructor (props: ColorSettingsMenuProps) {
    super(props)
    this.handleOpacityChange = this.handleOpacityChange.bind(this)
    this.handleColorRChange = this.handleColorRChange.bind(this)
    this.handleColorGChange = this.handleColorGChange.bind(this)
    this.handleColorBChange = this.handleColorBChange.bind(this)
    this.getCurrentColor = this.getCurrentColor.bind(this)
    this.state = {
      currentStyle: {
        opacity: this.props.defaultStyle.opacity,
        color: this.props.defaultStyle.color
      }
    }
  }

  handleOpacityChange (value: number | null): void {
    if (value != null) {
      this.props.annotationGroupsUIDs.forEach((uid) => {
        this.props.onStyleChange({
          annotationGroupUID: uid,
          styleOptions: {
            opacity: value
          }
        })
      })
      this.setState({
        currentStyle: {
          opacity: value,
          color: this.state.currentStyle.color
        }
      })
    }
  }

  handleColorRChange (value: number | number[] | null): void {
    if (value != null && this.state.currentStyle.color !== undefined) {
      const color = [
        Array.isArray(value) ? value[0] : value,
        this.state.currentStyle.color[1],
        this.state.currentStyle.color[2]
      ]
      this.setState((state) => ({
        currentStyle: {
          color: color,
          opacity: state.currentStyle.opacity
        }
      }))
      this.props.annotationGroupsUIDs.forEach((uid) => {
        this.props.onStyleChange({
          annotationGroupUID: uid,
          styleOptions: { color: color }
        })
      })
    }
  }

  handleColorGChange (value: number | number[] | null): void {
    if (value != null && this.state.currentStyle.color !== undefined) {
      const color = [
        this.state.currentStyle.color[0],
        Array.isArray(value) ? value[0] : value,
        this.state.currentStyle.color[2]
      ]
      this.setState((state) => ({
        currentStyle: {
          color: color,
          opacity: state.currentStyle.opacity
        }
      }))
      this.props.annotationGroupsUIDs.forEach((uid) => {
        this.props.onStyleChange({
          annotationGroupUID: uid,
          styleOptions: { color: color }
        })
      })
    }
  }

  handleColorBChange (value: number | number[] | null): void {
    if (value != null && this.state.currentStyle.color !== undefined) {
      const color = [
        this.state.currentStyle.color[0],
        this.state.currentStyle.color[1],
        Array.isArray(value) ? value[0] : value
      ]
      this.setState((state) => ({
        currentStyle: {
          color: color,
          opacity: state.currentStyle.opacity
        }
      }))

      this.props.annotationGroupsUIDs.forEach((uid) => {
        this.props.onStyleChange({
          annotationGroupUID: uid,
          styleOptions: { color: color }
        })
      })
    }
  }

  getCurrentColor (): string {
    const rgb2hex = (values: number[]): string => {
      const r = values[0]
      const g = values[1]
      const b = values[2]
      return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)
    }

    if (this.state.currentStyle.color != null) {
      return rgb2hex(this.state.currentStyle.color)
    } else {
      return 'white'
    }
  }

  render (): React.ReactNode {
    let colorSettings
    if (this.state.currentStyle.color != null) {
      colorSettings = (
        <>
          <Divider plain>Color</Divider>
          <Row justify='center' align='middle' gutter={[8, 8]}>
            <Col span={5}>Red</Col>
            <Col span={14}>
              <Slider
                range={false}
                min={0}
                max={255}
                step={1}
                value={this.state.currentStyle.color[0]}
                onChange={this.handleColorRChange}
              />
            </Col>
            <Col span={5}>
              <InputNumber
                min={0}
                max={255}
                size='small'
                style={{ width: '65px' }}
                value={this.state.currentStyle.color[0]}
                onChange={this.handleColorRChange}
              />
            </Col>
          </Row>

          <Row justify='center' align='middle' gutter={[8, 8]}>
            <Col span={5}>Green</Col>
            <Col span={14}>
              <Slider
                range={false}
                min={0}
                max={255}
                step={1}
                value={this.state.currentStyle.color[1]}
                onChange={this.handleColorGChange}
              />
            </Col>
            <Col span={5}>
              <InputNumber
                min={0}
                max={255}
                size='small'
                style={{ width: '65px' }}
                value={this.state.currentStyle.color[1]}
                onChange={this.handleColorGChange}
              />
            </Col>
          </Row>

          <Row justify='center' align='middle' gutter={[8, 8]}>
            <Col span={5}>Blue</Col>
            <Col span={14}>
              <Slider
                range={false}
                min={0}
                max={255}
                step={1}
                value={this.state.currentStyle.color[2]}
                onChange={this.handleColorBChange}
              />
            </Col>
            <Col span={5}>
              <InputNumber
                min={0}
                max={255}
                size='small'
                style={{ width: '65px' }}
                value={this.state.currentStyle.color[2]}
                onChange={this.handleColorBChange}
              />
            </Col>
          </Row>
          <Divider plain />
        </>
      )
    }

    return (
      <div>
        {colorSettings}
        <Row justify='start' align='middle' gutter={[8, 8]}>
          <Col span={6}>Opacity</Col>
          <Col span={12}>
            <Slider
              range={false}
              min={0}
              max={1}
              step={0.01}
              value={this.state.currentStyle.opacity}
              onChange={this.handleOpacityChange}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              min={0}
              max={1}
              size='small'
              step={0.1}
              style={{ width: '65px' }}
              value={this.state.currentStyle.opacity}
              onChange={this.handleOpacityChange}
            />
          </Col>
        </Row>
      </div>
    )
  }
}

export default ColorSettingsMenu
