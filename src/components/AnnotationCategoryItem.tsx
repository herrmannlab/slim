import React from 'react'
import { Menu, Space, Checkbox, Tooltip, Popover, Button } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { Category, Type } from './AnnotationCategoryList'
import ColorSettingsMenu from './ColorSettingsMenu'

const AnnotationGroupItem = ({
  category,
  onChange,
  checkedAnnotationGroupUids,
  onStyleChange,
  defaultAnnotationGroupStyles
}: {
  category: Category
  onChange: Function
  onStyleChange: Function
  defaultAnnotationGroupStyles: {
    [annotationGroupUID: string]: {
      opacity: number
      color: number[]
    }
  }
  checkedAnnotationGroupUids: Set<string>
}): JSX.Element => {
  const { types } = category

  const onCheckCategoryChange = (e: any): void => {
    const isVisible = e.target.checked
    types.forEach((type: Type) => {
      handleChangeCheckedType({ type, isVisible })
    })
  }

  const checkAll = types.every((type: Type) =>
    type.uids.every((uid: string) => checkedAnnotationGroupUids.has(uid))
  )
  const indeterminate =
    !checkAll &&
    types.some((type: Type) =>
      type.uids.some((uid: string) => checkedAnnotationGroupUids.has(uid))
    )

  const handleChangeCheckedType = ({
    type,
    isVisible
  }: {
    type: Type
    isVisible: boolean
  }): void => {
    type.uids.forEach((uid: string) => {
      onChange({ annotationGroupUID: uid, isVisible })
    })
  }

  return (
    <Menu.Item
      style={{ height: '100%', paddingLeft: '3px' }}
      key={category.CodeMeaning}
    >
      <Space align='start'>
        <div style={{ paddingLeft: '14px' }}>
          <Space direction='vertical' align='end'>
            <Checkbox
              indeterminate={indeterminate}
              checked={checkAll}
              onChange={onCheckCategoryChange}
            >
              <Tooltip
                title={`${category.CodeValue}:${category.CodingSchemeDesignator}`}
                mouseEnterDelay={1}
              >
                {category.CodeMeaning}
              </Tooltip>
              <Popover
                placement='topLeft'
                overlayStyle={{ width: '350px' }}
                title='Display Settings'
                content={() => (
                  <ColorSettingsMenu
                    annotationGroupsUIDs={types.reduce(
                      (acc: string[], type) => {
                        return [...acc, ...type.uids]
                      },
                      []
                    )}
                    onStyleChange={onStyleChange}
                    defaultStyle={
                      defaultAnnotationGroupStyles[types[0].uids[0]]
                    }
                  />
                )}
              >
                <Button
                  type='primary'
                  shape='circle'
                  style={{ marginLeft: '10px' }}
                  icon={<SettingOutlined />}
                />
              </Popover>
            </Checkbox>
          </Space>
          {types.map((type: Type) => {
            const { CodeMeaning, CodingSchemeDesignator, CodeValue, uids } =
              type
            const isChecked = uids.every((uid: string) =>
              checkedAnnotationGroupUids.has(uid)
            )
            const indeterminateType =
              !isChecked &&
              uids.some((uid: string) => checkedAnnotationGroupUids.has(uid))
            return (
              <div
                key={`${type.CodingSchemeDesignator}:${type.CodeMeaning}`}
                style={{ paddingLeft: '25px' }}
              >
                <Checkbox
                  indeterminate={indeterminateType}
                  checked={isChecked}
                  onChange={(e: any) =>
                    handleChangeCheckedType({
                      type,
                      isVisible: e.target.checked
                    })}
                >
                  <Tooltip
                    title={`${CodeValue}:${CodingSchemeDesignator}`}
                    mouseEnterDelay={1}
                  >
                    {CodeMeaning}
                  </Tooltip>
                  <Popover
                    placement='topLeft'
                    overlayStyle={{ width: '350px' }}
                    title='Display Settings'
                    content={() => (
                      <ColorSettingsMenu
                        annotationGroupsUIDs={type.uids}
                        onStyleChange={onStyleChange}
                        defaultStyle={
                          defaultAnnotationGroupStyles[type.uids[0]]
                        }
                      />
                    )}
                  >
                    <Button
                      type='primary'
                      shape='circle'
                      style={{ marginLeft: '10px' }}
                      icon={<SettingOutlined />}
                    />
                  </Popover>
                </Checkbox>
              </div>
            )
          })}
        </div>
      </Space>
    </Menu.Item>
  )
}

export default AnnotationGroupItem
