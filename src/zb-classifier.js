/**
 *
 * ZigbeeClassifier - Determines properties from Zigbee clusters.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const {
  CLUSTER_ID,
  COLOR_CAPABILITY,
  DOORLOCK_EVENT_CODES,
  HVAC_FAN_SEQ,
  PROFILE_ID,
  THERMOSTAT_SYSTEM_MODE,
  ZHA_DEVICE_ID,
  ZLL_DEVICE_ID,
  ZONE_STATUS,
} = require('./zb-constants');

const ZigbeeProperty = require('./zb-property');

const { Utils } = require('gateway-addon');

const { DEBUG_classifier } = require('./zb-debug').default;
const DEBUG = DEBUG_classifier;

const ZONE_TYPE_MOTION = 0x000d;
const ZONE_TYPE_SWITCH = 0x0015;

// From the ZigBee Cluster Library Specification, document 07-5123-06,
// Revision 6, Draft Version 1.0.
// Table 8-5 - Values of the ZoneType Attribute
const ZONE_TYPE_NAME = {
  [ZONE_TYPE_MOTION]: {
    // 0x000d
    type: 'motion-sensor',
    '@type': ['MotionSensor'],
    propertyName: 'motion',
    propertyDescr: {
      '@type': 'MotionProperty',
      type: 'boolean',
      label: 'Motion',
      description: 'Motion Sensor',
      readOnly: true,
    },
  },
  [ZONE_TYPE_SWITCH]: {
    // 0x0015
    type: 'door-sensor',
    '@type': ['DoorSensor'],
    propertyName: 'open',
    propertyDescr: {
      '@type': 'OpenProperty',
      type: 'boolean',
      label: 'Open',
      description: 'Contact Switch',
      readOnly: true,
    },
  },
  0x0028: {
    type: 'smoke-sensor',
    '@type': ['SmokeSensor'],
    propertyName: 'on',
    propertyDescr: {
      '@type': 'SmokeProperty',
      type: 'boolean',
      label: 'Smoke',
      description: 'Smoke Sensor',
      readOnly: true,
    },
  },
  0x002a: {
    type: 'leak-sensor',
    '@type': ['LeakSensor'],
    propertyName: 'on',
    propertyDescr: {
      '@type': 'LeakProperty',
      type: 'boolean',
      label: 'Water',
      description: 'Water Sensor',
      readOnly: true,
    },
  },
  0x002b: {
    type: 'co-sensor',
    '@type': ['BinarySensor'],
    propertyName: 'on',
    propertyDescr: {
      '@type': 'BooleanProperty',
      type: 'boolean',
      label: 'CO',
      description: 'Carbon Monoxide Sensor',
      readOnly: true,
    },
  },
  0x002c: {
    type: 'ped-button',
    '@type': ['PushButton'],
    propertyName: 'pushed',
    propertyDescr: {
      '@type': 'PushedProperty',
      type: 'boolean',
      label: 'Pressed',
      description: 'Personal Emergency Device',
      readOnly: true,
    },
  },
  0x002d: {
    type: 'vibration-sensor',
    '@type': ['BinarySensor'],
    propertyName: 'on',
    propertyDescr: {
      '@type': 'BooleanProperty',
      type: 'boolean',
      label: 'Vibrating',
      description: 'Vibration/Movement Sensor',
      readOnly: true,
    },
  },
  0x010f: {
    type: 'remote-button',
    '@type': ['PushButton'],
    propertyName: 'pushed',
    propertyDescr: {
      '@type': 'PushedProperty',
      type: 'boolean',
      label: 'Pressed',
      description: 'Remote Control',
      readOnly: true,
    },
  },
  0x0115: {
    type: 'keyfob-button',
    '@type': ['PushButton'],
    propertyName: 'pushed',
    propertyDescr: {
      '@type': 'PushedProperty',
      type: 'boolean',
      label: 'Pressed',
      description: 'Keyfob',
      readOnly: true,
    },
  },
  0x021d: {
    type: 'keypad-button',
    '@type': ['PushButton'],
    propertyName: 'pushed',
    propertyDescr: {
      '@type': 'PushedProperty',
      type: 'boolean',
      label: 'Pressed',
      description: 'Keypad',
      readOnly: true,
    },
  },
  0x0226: {
    type: 'glass-sensor',
    '@type': ['BinarySensor'],
    propertyName: 'on',
    propertyDescr: {
      '@type': 'BooleanProperty',
      type: 'boolean',
      label: 'Breakage',
      description: 'Glass Break Sensor',
      readOnly: true,
    },
  },
};

// The newer SmartThings sensors report a zoneType of zero, so we
// use the modelId to further classify them
const ZONE_TYPE_ZERO = {
  multiv4: ZONE_TYPE_SWITCH,
  motionv4: ZONE_TYPE_MOTION,
  motionv5: ZONE_TYPE_MOTION,
};

// One way to do a deepEqual that turns out to be fairly performant.
// See: http://www.mattzeunert.com/2016/01/28/javascript-deep-equal.html
function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const CONFIG_REPORT_INTEGER = {
  minRepInterval: 1, // seconds
  maxRepInterval: 120, // seconds
  repChange: 1,
};

const CONFIG_REPORT_CURRENT = {
  minRepInterval: 5, // seconds
  maxRepInterval: 120, // seconds
  repChange: 10,
};

const CONFIG_REPORT_VOLTAGE = {
  minRepInterval: 5, // seconds
  maxRepInterval: 120, // seconds
  repChange: 10,
};

const CONFIG_REPORT_POWER = {
  minRepInterval: 5, // seconds
  maxRepInterval: 120, // seconds
  repChange: 10,
};

const CONFIG_REPORT_FREQUENCY = {
  minRepInterval: 5, // seconds
  maxRepInterval: 120, // seconds
  repChange: 2,
};

const CONFIG_REPORT_BATTERY = {
  minRepInterval: 10 * 60, // 10 minutes
  maxRepInterval: 30 * 60, // 30 minutes
  repChange: 2, // 0.2 V
};

const CONFIG_REPORT_ILLUMINANCE = {
  minRepInterval: 0,
  maxRepInterval: 10 * 60, // 10 minutes
  repChange: 0xffff, // disabled
};

const CONFIG_REPORT_TEMPERATURE = {
  minRepInterval: 1 * 60, // 1 minute
  maxRepInterval: 10 * 60, // 10 minutes
  repChange: 50, // 0.5 C
};

const CONFIG_REPORT_MODE = {
  minRepInterval: 1, // 1 second
  maxRepInterval: 10 * 60, // 10 minutes
  repChange: 1, // any change in value
};

class ZigbeeClassifier {
  constructor() {
    this.frames = [];
  }

  appendFrames(frames) {
    this.frames = this.frames.concat(frames);
  }

  prependFrames(frames) {
    this.frames = frames.concat(this.frames);
  }

  addColorProperty(node, lightingColorCtrlEndpoint) {
    const endpoint = node.activeEndpoints[lightingColorCtrlEndpoint];
    this.addProperty(
      node, // device
      '_level', // name
      {
        // property description
        type: 'number',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 0.1,
      },
      endpoint.profileId, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.GENLEVELCTRL, // clusterId
      'currentLevel', // attr
      'setLevelValue', // setAttrFromValue
      'parseLevelAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'color', // name
      {
        // property description
        '@type': 'ColorProperty',
        label: 'Color',
        type: 'string',
      },
      endpoint.profileId, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.LIGHTINGCOLORCTRL, // clusterId
      'currentHue,currentSaturation', // attr
      'setColorValue', // setAttrFromValue
      'parseColorAttr' // parseValueFromAttr
    );
  }

  addColorXYProperty(node, lightingColorCtrlEndpoint) {
    const endpoint = node.activeEndpoints[lightingColorCtrlEndpoint];
    this.addProperty(
      node, // device
      '_level', // name
      {
        // property description
        type: 'number',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 0.1,
      },
      endpoint.profileId, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.GENLEVELCTRL, // clusterId
      'currentLevel', // attr
      'setLevelValue', // setAttrFromValue
      'parseLevelAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'color', // name
      {
        // property description
        '@type': 'ColorProperty',
        label: 'Color',
        type: 'string',
      },
      endpoint.profileId, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.LIGHTINGCOLORCTRL, // clusterId
      'currentX,currentY', // attr
      'setColorXYValue', // setAttrFromValue
      'parseColorXYAttr' // parseValueFromAttr
    );
  }

  addColorTemperatureProperty(node, lightingColorCtrlEndpoint) {
    this.addProperty(
      node, // device
      '_minTemperature', // name
      {
        // property description
        type: 'number',
      },
      PROFILE_ID.ZHA, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.LIGHTINGCOLORCTRL, // clusterId
      'colorTempPhysicalMin', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      153 // defaultValue (153 = 6535K)
    );
    this.addProperty(
      node, // device
      '_maxTemperature', // name
      {
        // property description
        type: 'number',
      },
      PROFILE_ID.ZHA, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.LIGHTINGCOLORCTRL, // clusterId
      'colorTempPhysicalMax', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      370 // defaultValue (370 = 2700K)
    );
    this.addProperty(
      node, // device
      'colorTemperature', // name
      {
        // property description
        '@type': 'ColorTemperatureProperty',
        label: 'Color Temperature',
        type: 'number',
        unit: 'kelvin',
      },
      PROFILE_ID.ZHA, // profileId
      lightingColorCtrlEndpoint, // endpoint
      CLUSTER_ID.LIGHTINGCOLORCTRL, // clusterId
      'colorTemperature', // attr
      'setColorTemperatureValue', // setAttrFromValue
      'parseColorTemperatureAttr', // parseValueFromAttr
      null, // configReport
      370 // defaultValue
    );
    // IKEA color temperature bulbs return an unsupportedAttribute error
    // when trying to read the current color temperature. We set the
    // defaultValue to 370 so that it's numeric, and then
    // parseColorTemperatureAttr will clamp it to fall between the min/max
  }

  addBrightnessProperty(node, genLevelCtrlEndpoint) {
    const endpoint = node.activeEndpoints[genLevelCtrlEndpoint];
    this.addProperty(
      node, // device
      'level', // name
      {
        // property description
        '@type': 'BrightnessProperty',
        label: 'Brightness',
        type: 'number',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 0.1,
      },
      endpoint.profileId, // profileId
      genLevelCtrlEndpoint, // endpoint
      CLUSTER_ID.GENLEVELCTRL, // clusterId
      'currentLevel', // attr
      'setLevelValue', // setAttrFromValue
      'parseLevelAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
  }

  addDeviceTemperatureProperty(node, genDeviceTempCfgEndpoint) {
    this.addProperty(
      node, // device
      'temperature', // name
      {
        // property description
        '@type': 'TemperatureProperty',
        label: 'Temperature',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genDeviceTempCfgEndpoint, // endpoint
      CLUSTER_ID.GENDEVICETEMPCFG, // clusterId
      'currentTemperature', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );

    if (!node['@type'].includes('TemperatureSensor')) {
      node['@type'].push('TemperatureSensor');
    }
  }

  addLevelProperty(node, genLevelCtrlEndpoint) {
    const endpoint = node.activeEndpoints[genLevelCtrlEndpoint];
    this.addProperty(
      node, // device
      'level', // name
      {
        // property description
        '@type': 'LevelProperty',
        label: 'Level',
        type: 'number',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 0.1,
      },
      endpoint.profileId, // profileId
      genLevelCtrlEndpoint, // endpoint
      CLUSTER_ID.GENLEVELCTRL, // clusterId
      'currentLevel', // attr
      'setLevelValue', // setAttrFromValue
      'parseLevelAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
  }

  addOnProperty(node, genOnOffEndpoint, suffix) {
    if (typeof suffix === 'undefined') {
      suffix = '';
    }
    const endpoint = node.activeEndpoints[genOnOffEndpoint];
    const property = this.addProperty(
      node, // device
      `on${suffix}`, // name
      {
        // property description
        '@type': suffix ? 'BooleanProperty' : 'OnOffProperty',
        label: suffix ? `On/Off (${suffix})` : 'On/Off',
        type: 'boolean',
      },
      endpoint.profileId, // profileId
      genOnOffEndpoint, // endpoint
      CLUSTER_ID.GENONOFF, // clusterId
      'onOff', // attr
      'setOnOffValue', // setAttrFromValue
      'parseOnOffAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
    if (endpoint.deviceId === '000b') {
      // The ORVIBO Smart Relay doesn't seem to support config reports. It
      // also doesn't seem to have a reasonable modelId (the report I got showed
      // a modelId of 82c167c95ed746cdbd21d6817f72c593), so I'm not sure if
      // that's real or not. It also showed a deviceId of 000b which doesn't
      // seem to be documented in the zigbee spec, so for now, I'm using that
      // to identify this. I have one on order and when it arrives I'll get a
      // chance to play with it and see if the weird string of numbers really
      // is a valid modelId.
      property.fireAndForget = true;
    }
    if (typeof property.value === 'undefined') {
      property.value = false;
    }
    if (!node.onOffProperty) {
      node.onOffProperty = property;
    }
    return property;
  }

  addButtonOnProperty(node, genOnOffOutputEndpoint, suffix) {
    if (typeof suffix === 'undefined') {
      suffix = '';
    }
    const property = this.addProperty(
      node, // device
      `on${suffix}`, // name
      {
        // property description
        '@type': 'BooleanProperty',
        label: suffix ? `On/Off (${suffix})` : 'On/Off',
        type: 'boolean',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genOnOffOutputEndpoint, // endpoint
      CLUSTER_ID.GENONOFF, // clusterId
      '', // attr
      '', // setAttrFromValue
      '' // parseValueFromAttr
    );
    property.bindNeeded = true;
    if (typeof property.value === 'undefined') {
      property.value = false;
    }
    if (!node.onOffProperty) {
      node.onOffProperty = property;
    }
    DEBUG &&
      console.log('addProperty:', '  bindNeeded:', property.bindNeeded, 'value:', property.value);
    return property;
  }

  addButtonLevelProperty(node, genLevelCtrlOutputEndpoint, suffix) {
    if (typeof suffix === 'undefined') {
      suffix = '';
    }
    const property = this.addProperty(
      node, // device
      `level${suffix}`, // name
      {
        // property description
        '@type': 'LevelProperty',
        label: suffix ? `Level (${suffix})` : 'Level',
        type: 'number',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 0.1,
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genLevelCtrlOutputEndpoint, // endpoint
      CLUSTER_ID.GENLEVELCTRL, // clusterId
      '', // attr
      '', // setAttrFromValue
      '' // parseValueFromAttr
    );
    property.bindNeeded = true;
    if (typeof property.value === 'undefined') {
      property.value = 0;
    }
    DEBUG &&
      console.log('addProperty:', '  bindNeeded:', property.bindNeeded, 'value:', property.value);
    return property;
  }

  addButtonMotionProperty(node, genOnOffOutputEndpoint, suffix) {
    if (typeof suffix === 'undefined') {
      suffix = '';
    }
    const property = this.addProperty(
      node, // device
      `motion${suffix}`, // name
      {
        // property description
        '@type': 'MotionProperty',
        type: 'boolean',
        label: suffix ? `Motion (${suffix})` : 'Motion',
        description: 'Motion Sensor',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genOnOffOutputEndpoint, // endpoint
      CLUSTER_ID.GENONOFF, // clusterId
      '', // attr
      '', // setAttrFromValue
      '' // parseValueFromAttr
    );
    property.bindNeeded = true;
    if (typeof property.value === 'undefined') {
      property.value = false;
    }
    DEBUG &&
      console.log('addProperty:', '  bindNeeded:', property.bindNeeded, 'value:', property.value);
    return property;
  }

  addButtonSceneProperty(node, genScenesOutputEndpoint) {
    const property = this.addProperty(
      node, // device
      'scene', // name
      {
        // property description
        '@type': 'LevelProperty',
        label: 'Scene',
        type: 'integer',
        minimum: 0,
        maximum: 15,
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genScenesOutputEndpoint, // endpoint
      CLUSTER_ID.GENSCENES, // clusterId
      '', // attr
      '', // setAttrFromValue
      '' // parseValueFromAttr
    );
    property.bindNeeded = false;
    if (typeof property.value !== 'number') {
      property.value = 0;
    }
    console.log('addButtonSceneProperty: scene value:', property.value);
    DEBUG &&
      console.log('addProperty:', '  bindNeeded:', property.bindNeeded, 'value:', property.value);
    return property;
  }

  addDoorLockedProperty(node, doorLockEndpoint) {
    // The lockState is both state and control, so we create
    // a hidden property which is a boolean, and have the visible
    // state be an enumeration.
    node.doorLockProperty = this.addProperty(
      node, // device
      '_lockedInterntal', // name
      {
        // property description
        '@type': 'BooleanProperty',
        label: 'Locked',
        type: 'boolean',
      },
      PROFILE_ID.ZHA, // profileId
      doorLockEndpoint, // endpoint
      CLUSTER_ID.DOORLOCK, // clusterId
      'lockState', // attr
      'setDoorLockedValue', // setAttrFromValue
      'parseDoorLockedAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
    node.doorLockState = this.addProperty(
      node,
      'locked',
      {
        '@type': 'LockedProperty',
        type: 'string',
        title: 'State',
        enum: ['locked', 'unlocked', 'jammed', 'unknown'],
        readOnly: true,
      },
      0, // profileId
      0, // endpoint
      0, // clusterId
      '' // attr
    );

    // When the internal state changes, then we update the visible state.
    node.doorLockProperty.updated = function () {
      const state = node.doorLockProperty.value ? 'locked' : 'unlocked';
      node.setPropertyValue(node.doorLockState, state);
      if (node.doorLockTimeout) {
        clearTimeout(node.doorLockTimeout);
        node.doorLockTimeout = null;
      }
      if (node.doorLockAction) {
        const doorLockAction = node.doorLockAction;
        node.doorLockAction = null;
        doorLockAction.finish();
      }
    };
    // Set the initial state. Assume that the doorlock isn't jammed.
    node.doorLockProperty.updated();

    const doorLockEvents = {};
    for (const eventCode of DOORLOCK_EVENT_CODES) {
      doorLockEvents[eventCode] = { '@type': 'DoorLockEvent' };
    }
    this.addEvents(node, doorLockEvents);

    this.addActions(node, {
      lock: {
        '@type': 'LockAction',
        title: 'Lock',
        description: 'Lock the deadbolt',
      },
      unlock: {
        '@type': 'UnlockAction',
        title: 'Unlock',
        description: 'Unlock the deadbolt',
      },
    });

    // Set the checkin interval for door locks to be faster since we
    // may need to talk to them.
    node.slowCheckinInterval = 1 * 60 * 4; // 1 minute (quarterseconds)
  }

  addPresentValueProperty(node, genBinaryInputEndpoint) {
    this.addProperty(
      node, // device
      'on', // name
      {
        // property description
        '@type': 'BooleanProperty',
        label: 'Present',
        type: 'boolean',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      genBinaryInputEndpoint, // endpoint
      CLUSTER_ID.GENBINARYINPUT, // clusterId
      'presentValue', // attr
      'setOnOffValue', // setAttrFromValue
      'parseOnOffAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
  }

  addHaCurrentProperty(node, haElectricalEndpoint) {
    this.addProperty(
      node, // device
      '_currentMul', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acCurrentMultiplier', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      '_currentDiv', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acCurrentDivisor', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      'current', // name
      {
        // property description
        '@type': 'CurrentProperty',
        label: 'Current',
        type: 'number',
        unit: 'ampere',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'rmsCurrent', // attr
      '', // setAttrFromValue
      'parseHaCurrentAttr', // parseValueFromAttr
      CONFIG_REPORT_CURRENT
    );
  }

  addHaFrequencyProperty(node, haElectricalEndpoint) {
    this.addProperty(
      node, // device
      'frequency', // name
      {
        // property description
        '@type': 'FrequencyProperty',
        label: 'Frequency',
        type: 'number',
        unit: 'hertz',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acFrequency', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      CONFIG_REPORT_FREQUENCY
    );
  }

  addHaInstantaneousPowerProperty(node, haElectricalEndpoint) {
    this.addProperty(
      node, // device
      '_powerMul', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acPowerMultiplier', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      '_powerDiv', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acPowerDivisor', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      'instantaneousPower', // name
      {
        // property description
        '@type': 'InstantaneousPowerProperty',
        label: 'Power',
        type: 'number',
        unit: 'watt',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'activePower', // attr
      '', // setAttrFromValue
      'parseHaInstantaneousPowerAttr', // parseValueFromAttr
      CONFIG_REPORT_POWER
    );
  }

  addHaVoltageProperty(node, haElectricalEndpoint) {
    this.addProperty(
      node, // device
      '_voltageMul', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acVoltageMultiplier', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      '_voltageDiv', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'acVoltageDivisor', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      'voltage', // name
      {
        // property description
        '@type': 'VoltageProperty',
        label: 'Voltage',
        type: 'number',
        unit: 'volt',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      haElectricalEndpoint, // endpoint
      CLUSTER_ID.HAELECTRICAL, // clusterId
      'rmsVoltage', // attr
      '', // setAttrFromValue
      'parseHaVoltageAttr', // parseValueFromAttr
      CONFIG_REPORT_VOLTAGE
    );
  }

  addSeCurrentSummDeliveredProperty(node, seMeteringEndpoint) {
    this.addProperty(
      node, // device
      '_counterMul', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'currentSummDeliveredMultiplier', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      1 // defaultValue
    );
    this.addProperty(
      node, // device
      '_counterDiv', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'currentSummDeliveredDivisor', // attr
      '', // setAttrFromValue
      'parseNumericAttr', // parseValueFromAttr
      null, // configReport
      // use a default of 1000 for now until
      // new attribute definitions are available
      1000 // defaultValue
    );
    this.addProperty(
      node, // device
      'counter', // name
      {
        // property description
        label: 'Total Energy',
        type: 'number',
        unit: 'watt',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'currentSummDelivered', // attr
      '', // setAttrFromValue
      'parseSeCurrentSummDeliveredAttr', // parseValueFromAttr
      CONFIG_REPORT_MODE
    );
  }

  addSeInstantaneousPowerProperty(node, seMeteringEndpoint) {
    this.addProperty(
      node, // device
      '_multiplier', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'multiplier', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      '_divisor', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'divisor', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'instantaneousPower', // name
      {
        // property description
        '@type': 'InstantaneousPowerProperty',
        label: 'Power',
        type: 'number',
        unit: 'watt',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      seMeteringEndpoint, // endpoint
      CLUSTER_ID.SEMETERING, // clusterId
      'instantaneousDemand', // attr
      '', // setAttrFromValue
      'parseSeInstantaneousPowerAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
  }

  addOccupancySensorProperty(node, msOccupancySensingEndpoint) {
    this.addProperty(
      node, // device
      'occupied', // name
      {
        // property description
        '@type': 'BooleanProperty',
        type: 'boolean',
        label: 'Occupied',
        description: 'Occupancy Sensor',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msOccupancySensingEndpoint, // endpoint
      CLUSTER_ID.OCCUPANCY_SENSOR, // clusterId
      'occupancy', // attr
      '', // setAttrFromValue
      'parseOccupiedAttr', // parseValueFromAttr
      CONFIG_REPORT_INTEGER
    );
    this.addProperty(
      node, // device
      'sensorType', // name
      {
        // property description
        label: 'Sensor Type',
        type: 'string',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msOccupancySensingEndpoint, // endpoint
      CLUSTER_ID.OCCUPANCY_SENSOR, // clusterId
      'occupancySensorType', // attr
      '', // setAttrFromValue
      'parseOccupancySensorTypeAttr' // parseValueFromAttr
    );
  }

  addIlluminanceMeasurementProperty(node, msMeasurementEndpoint) {
    this.addProperty(
      node, // device
      '_minIlluminance', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msMeasurementEndpoint, // endpoint
      CLUSTER_ID.ILLUMINANCE_MEASUREMENT, // clusterId
      'minMeasuredValue', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      '_maxIlluminance', // name
      {
        // property description
        type: 'number',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msMeasurementEndpoint, // endpoint
      CLUSTER_ID.ILLUMINANCE_MEASUREMENT, // clusterId
      'maxMeasuredValue', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'illuminance', // name
      {
        // property description
        '@type': 'IlluminanceProperty',
        label: 'Illuminance',
        type: 'number',
        unit: 'lux',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msMeasurementEndpoint, // endpoint
      CLUSTER_ID.ILLUMINANCE_MEASUREMENT, // clusterId
      'measuredValue', // attr
      '', // setAttrFromValue
      'parseIlluminanceMeasurementAttr', // parseValueFromAttr
      CONFIG_REPORT_ILLUMINANCE
    );
  }

  addPowerCfgVoltageProperty(node, genPowerCfgEndpoint) {
    if (node.isMainsPowered()) {
      this.addProperty(
        node, // device
        'mainsVoltage', // name
        {
          // property description
          '@type': 'VoltageProperty',
          label: 'Mains Voltage',
          type: 'number',
          unit: 'volt',
          multipleOf: 0.1,
          readOnly: true,
        },
        PROFILE_ID.ZHA, // profileId
        genPowerCfgEndpoint, // endpoint
        CLUSTER_ID.GENPOWERCFG, // clusterId
        'mainsVoltage', // attr
        '', // setAttrFromValue
        'parseNumericTenthsAttr', // parseValueFromAttr
        CONFIG_REPORT_BATTERY
      );
    }

    // Some devices report that they have a power source of "unknown" but are
    // actually battery powered.
    const hasBattery = [
      '1116-S', // Iris V3 Contact Sensor
      'motionv4', // SmartThings V4 Motion Sensor
      'motionv5', // SmartThings V5 Motion Sensor
      'multiv4', // SmartThings V4 Multi Sensor
      'tagv4', // SmartThings V4 Arrival Sensor
    ];

    // Bit 7 indicates the backup power source, i.e. battery
    if (
      node.isBatteryPowered() ||
      node.powerSource & (0x80 !== 0) ||
      hasBattery.includes(node.modelId)
    ) {
      this.addProperty(
        node, // device
        'batteryVoltage', // name
        {
          // property description
          '@type': 'VoltageProperty',
          label: 'Battery Voltage',
          type: 'number',
          unit: 'volt',
          multipleOf: 0.1,
          readOnly: true,
        },
        PROFILE_ID.ZHA, // profileId
        genPowerCfgEndpoint, // endpoint
        CLUSTER_ID.GENPOWERCFG, // clusterId
        'batteryVoltage', // attr
        '', // setAttrFromValue
        'parseNumericTenthsAttr', // parseValueFromAttr
        CONFIG_REPORT_BATTERY
      );
    }

    if (node.isBatteryPowered()) {
      const attrBP = 'batteryPercentageRemaining';
      this.addProperty(
        node, // device
        attrBP, // name
        {
          // property description
          label: 'Battery Percentage Remaining',
          type: 'number',
          unit: 'percent',
          minimum: 0,
          maximum: 100,
          multipleOf: 0.5,
          readOnly: true,
        },
        PROFILE_ID.ZHA, // profileId
        genPowerCfgEndpoint, // endpoint
        CLUSTER_ID.GENPOWERCFG, // clusterId
        attrBP, // attr
        '', // setAttrFromValue
        'parseHalfPercentAttr', // parseValueFromAttr
        null, // configReport - use device internal settings
        null // defaultValue
      );
    }
  }

  addTemperatureSensorProperty(node, msTemperatureEndpoint) {
    this.addProperty(
      node, // device
      '_minTemp', // name
      {
        // property description
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msTemperatureEndpoint, // endpoint
      CLUSTER_ID.TEMPERATURE, // clusterId
      'minMeasuredValue', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      '_maxTemp', // name
      {
        // property description
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msTemperatureEndpoint, // endpoint
      CLUSTER_ID.TEMPERATURE, // clusterId
      'maxMeasuredValue', // attr
      '', // setAttrFromValue
      'parseNumericAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'temperature', // name
      {
        // property description
        '@type': 'TemperatureProperty',
        label: 'Temperature',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      msTemperatureEndpoint, // endpoint
      CLUSTER_ID.TEMPERATURE, // clusterId
      'measuredValue', // attr
      '', // setAttrFromValue
      'parseTemperatureMeasurementAttr', // parseValueFromAttr
      CONFIG_REPORT_TEMPERATURE
    );

    if (!node['@type'].includes('TemperatureSensor')) {
      node['@type'].push('TemperatureSensor');
    }
  }

  addThermostatProperties(node, hvacThermostatEndpoint, hvacFanControlEndpoint) {
    this.addProperty(
      node, // device
      'temperature', // name
      {
        // property description
        '@type': 'TemperatureProperty',
        label: 'Temperature',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
        minimum: 0,
        maximum: 40,
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'localTemp', // attr
      '', // setAttrFromValue
      'parseNumericHundredthsAttr', // parseValueFromAttr
      CONFIG_REPORT_TEMPERATURE
    );
    this.addProperty(
      node, // device
      'mode', // name
      {
        // property description
        '@type': 'ThermostatModeProperty',
        label: 'Mode',
        type: 'string',
        enum: THERMOSTAT_SYSTEM_MODE.filter((x) => x),
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'systemMode', // attr
      'setThermostatSystemModeValue', // setAttrFromValue
      'parseThermostatSystemModeAttr' // parseValueFromAttr
    );
    this.addProperty(
      node, // device
      'runMode', // name
      {
        // property description
        '@type': 'HeatingCoolingProperty',
        label: 'Run Mode',
        type: 'string',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'runningMode', // attr
      '', // setAttrFromValue
      'parseThermostatRunModeAttr', // parseValueFromAttr
      CONFIG_REPORT_MODE
    );

    const deadbandProperty = this.addProperty(
      node, // device
      '_deadband', // name
      {
        // property description
        label: 'DeadBand',
        type: 'number',
        unit: 'degree celsius',
        minimum: 1,
        maximum: 2.5,
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'minSetpointDeadBand', // attr
      '', // setAttrFromValue
      'parseNumericTenthsAttr' // parseValueFromAttr
    );

    const absMaxHeatTargetProperty = this.addProperty(
      node, // device
      '_absMaxHeatTarget', // name
      {
        // property description
        label: 'Abs Max Heat Target',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'absMaxHeatSetpointLimit', // attr
      '', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const absMinHeatTargetProperty = this.addProperty(
      node, // device
      '_absMinHeatTarget', // name
      {
        // property description
        label: 'Abs Min Heat Target',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'absMinHeatSetpointLimit', // attr
      '', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const maxHeatTargetProperty = this.addProperty(
      node, // device
      '_maxHeatTarget', // name
      {
        // property description
        label: 'Max Heat Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'maxHeatSetpointLimit', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const minHeatTargetProperty = this.addProperty(
      node, // device
      '_minHeatTarget', // name
      {
        // property description
        label: 'Min Heat Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'minHeatSetpointLimit', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const heatTargetProperty = this.addProperty(
      node, // device
      'heatTarget', // name
      {
        // property description
        '@type': 'TargetTemperatureProperty',
        label: 'Heat Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'occupiedHeatingSetpoint', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );

    const absMaxCoolTargetProperty = this.addProperty(
      node, // device
      '_absMaxCoolTarget', // name
      {
        // property description
        label: 'Abs Max Cool Target',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'absMaxCoolSetpointLimit', // attr
      '', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const absMinCoolTargetProperty = this.addProperty(
      node, // device
      '_absMinCoolTarget', // name
      {
        // property description
        label: 'Abs Min Cool Target',
        type: 'number',
        unit: 'degree celsius',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'absMinCoolSetpointLimit', // attr
      '', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const maxCoolTargetProperty = this.addProperty(
      node, // device
      '_maxCoolTarget', // name
      {
        // property description
        label: 'Max Cool Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'maxCoolSetpointLimit', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const minCoolTargetProperty = this.addProperty(
      node, // device
      '_minCoolTarget', // name
      {
        // property description
        label: 'Min Cool Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'minCoolSetpointLimit', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );
    const coolTargetProperty = this.addProperty(
      node, // device
      'coolTarget', // name
      {
        // property description
        '@type': 'TargetTemperatureProperty',
        label: 'Cool Target',
        type: 'number',
        unit: 'degree celsius',
        multipleOf: 0.5,
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'occupiedCoolingSetpoint', // attr
      'setThermostatTemperatureValue', // setAttrFromValue
      'parseNumericHundredthsAttr' // parseValueFromAttr
    );

    // The abs Min/Max Heat/Cool limits are the hardware defined
    // minimums and maximums. They are readOnly and can't be changed.
    //
    // The min/max Heat/Cool limits are user settable.
    //
    // The heating target and cooling target need to be separated by the
    // deadband amount.

    absMaxHeatTargetProperty.updated = function () {
      maxHeatTargetProperty.setMaximum(this.value);
    };

    maxHeatTargetProperty.updated = function () {
      heatTargetProperty.updateMaximum();
    };

    heatTargetProperty.updated = function () {
      maxHeatTargetProperty.setMinimum(this.value);
      minHeatTargetProperty.setMaximum(this.value);
      coolTargetProperty.updateMinimum();
    };

    heatTargetProperty.updateMaximum = function () {
      if (!maxHeatTargetProperty.hasOwnProperty('value')) {
        // We don't have enough information yet
        return;
      }

      if (
        (!deadbandProperty.hasOwnProperty('value') &&
          !coolTargetProperty.hasOwnProperty('value')) ||
        (deadbandProperty.value === null && coolTargetProperty.value === null)
      ) {
        // it looks like there's no cool target or deadband, so set based on
        // max heat target
        heatTargetProperty.setMaximum(maxHeatTargetProperty.value);
        return;
      } else if (
        !deadbandProperty.hasOwnProperty('value') ||
        !coolTargetProperty.hasOwnProperty('value')
      ) {
        // We don't have enough information yet
        return;
      }

      const max1 = maxHeatTargetProperty.value;
      const max2 = coolTargetProperty.value - deadbandProperty.value;
      heatTargetProperty.setMaximum(Math.min(max1, max2));
    };

    minHeatTargetProperty.updated = function () {
      heatTargetProperty.setMinimum(this.value);
    };

    absMinHeatTargetProperty.updated = function () {
      minHeatTargetProperty.setMinimum(this.value);
    };

    absMaxCoolTargetProperty.updated = function () {
      maxCoolTargetProperty.setMaximum(this.value);
    };

    maxCoolTargetProperty.updated = function () {
      coolTargetProperty.setMaximum(this.value);
    };

    coolTargetProperty.updated = function () {
      maxCoolTargetProperty.setMinimum(this.value);
      minCoolTargetProperty.setMaximum(this.value);
      heatTargetProperty.updateMaximum();
    };

    coolTargetProperty.updateMinimum = function () {
      if (!minCoolTargetProperty.hasOwnProperty('value')) {
        // We don't have enough information yet
        return;
      }

      if (
        (!deadbandProperty.hasOwnProperty('value') &&
          !heatTargetProperty.hasOwnProperty('value')) ||
        (deadbandProperty.value === null && heatTargetProperty.value === null)
      ) {
        // it looks like there's no heat target or deadband, so set based on
        // min cool target
        coolTargetProperty.setMinimum(minCoolTargetProperty.value);
        return;
      } else if (
        !deadbandProperty.hasOwnProperty('value') ||
        !heatTargetProperty.hasOwnProperty('value')
      ) {
        // We don't have enough information yet
        return;
      }

      const min1 = minCoolTargetProperty.value;
      const min2 = heatTargetProperty.value + deadbandProperty.value;
      coolTargetProperty.setMinimum(Math.max(min1, min2));
    };

    minCoolTargetProperty.updated = function () {
      coolTargetProperty.updateMinimum();
    };

    absMinCoolTargetProperty.updated = function () {
      minCoolTargetProperty.setMinimum(this.value);
    };

    deadbandProperty.updated = function () {
      heatTargetProperty.updateMaximum();
      coolTargetProperty.updateMinimum();
    };

    // It's possible that values have been persisted, but the mins/maxs
    // haven't been, so we call the update methods here to cover off that
    // case.
    heatTargetProperty.updateMaximum();
    coolTargetProperty.updateMinimum();

    if (minHeatTargetProperty.hasOwnProperty('value')) {
      heatTargetProperty.setMinimum(minHeatTargetProperty.value);
    }

    if (maxCoolTargetProperty.hasOwnProperty('value')) {
      coolTargetProperty.setMaximum(maxCoolTargetProperty.value);
    }

    this.addProperty(
      node, // device
      'hold', // name
      {
        // property description
        '@type': 'BooleanProperty',
        label: 'Hold',
        type: 'boolean',
      },
      PROFILE_ID.ZHA, // profileId
      hvacThermostatEndpoint, // endpoint
      CLUSTER_ID.HVACTHERMOSTAT, // clusterId
      'tempSetpointHold', // attr
      'setOnOffWriteValue', // setAttrFromValue
      'parseOnOffAttr', // parseValueFromAttr
      CONFIG_REPORT_MODE
    );

    const uiCfgEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.HVACUSERINTERFACECFG_HEX
    );

    if (uiCfgEndpoint) {
      this.addProperty(
        node, // device
        'units', // name
        {
          // property description
          label: 'Units',
          type: 'string',
          enum: ['C', 'F'],
        },
        PROFILE_ID.ZHA, // profileId
        uiCfgEndpoint, // endpoint
        CLUSTER_ID.HVACUSERINTERFACECFG, // clusterId
        'tempDisplayMode', // attr
        'setWriteEnumValue', // setAttrFromValue
        'parseEnumAttr' // parseValueFromAttr
      );
    }

    if (hvacFanControlEndpoint) {
      const fanModeSeqProperty = this.addProperty(
        node, // device
        '_fanModeSeq', // name
        {
          // property description
          label: 'Fan Sequence',
          type: 'string',
          enum: HVAC_FAN_SEQ,
          readOnly: true,
        },
        PROFILE_ID.ZHA, // profileId
        hvacFanControlEndpoint, // endpoint
        CLUSTER_ID.HVACFANCTRL, // clusterId
        'fanModeSequence', // attr
        '', // setAttrFromValue
        'parseEnumAttr' // parseValueFromAttr
      );
      const fanModeProperty = this.addProperty(
        node, // device
        'fanMode', // name
        {
          // property description
          label: 'Fan',
          type: 'string',
          enum: [],
        },
        PROFILE_ID.ZHA, // profileId
        hvacFanControlEndpoint, // endpoint
        CLUSTER_ID.HVACFANCTRL, // clusterId
        'fanMode', // attr
        'setFanModeValue', // setAttrFromValue
        'parseFanModeAttr', // parseValueFromAttr
        CONFIG_REPORT_MODE
      );

      fanModeSeqProperty.updated = function () {
        // Now that we know the allowed sequence, update the fan mode
        // enumeration.
        if (!this.hasOwnProperty('prevValue') || this.value != this.prevValue) {
          fanModeProperty.enum = this.value.split('/');
          console.log(
            'fanModeSeqProperty.updated: set fanModeProperty.enum to',
            fanModeProperty.enum
          );
          this.device.handleDeviceDescriptionUpdated();
          this.prevValue = this.value;
        }
      };
    }
  }

  addZoneTypeProperty(node, propertyName, propertyDescr) {
    if (propertyName && propertyDescr) {
      this.addProperty(
        node, // device
        propertyName, // name
        propertyDescr, // property description
        PROFILE_ID.ZHA, // profileId
        node.ssIasZoneEndpoint, // endpoint
        CLUSTER_ID.SSIASZONE, // clusterId
        '', // attr
        '', // setAttrFromValue
        '' // parseValueFromAttr
      ).mask = ZONE_STATUS.ALARM_MASK;

      this.addProperty(
        node, // device
        'tamper', // name
        {
          // property description
          '@type': 'TamperProperty',
          type: 'boolean',
          label: 'Tamper',
          readOnly: true,
        },
        PROFILE_ID.ZHA, // profileId
        node.ssIasZoneEndpoint, // endpoint
        CLUSTER_ID.SSIASZONE, // clusterId
        '', // attr
        '', // setAttrFromValue
        '' // parseValueFromAttr
      ).mask = ZONE_STATUS.TAMPER_MASK;
    }

    this.addProperty(
      node, // device
      'lowBattery', // name
      {
        // property description
        '@type': 'LowBatteryProperty',
        type: 'boolean',
        label: 'Low Battery',
        readOnly: true,
      },
      PROFILE_ID.ZHA, // profileId
      node.ssIasZoneEndpoint, // endpoint
      CLUSTER_ID.SSIASZONE, // clusterId
      '', // attr
      '', // setAttrFromValue
      '' // parseValueFromAttr
    ).mask = ZONE_STATUS.LOW_BATTERY_MASK;

    // Remove the cieAddr so that we'll requery it from the device.
    delete node.cieAddr;
  }

  addActions(node, actions) {
    for (const actionName in actions) {
      node.addAction(actionName, actions[actionName]);
    }
  }

  addEvents(node, events) {
    for (const eventName in events) {
      node.addEvent(eventName, events[eventName]);
    }
  }

  addLastSeenProperty(node) {
    if (node.driver.config.showAging) {
      const lastSeen = new ZigbeeProperty(
        node,
        'lastSeen', // name
        {
          type: 'string',
          readOnly: true,
          label: 'Last seen',
        },
        '', // profileId
        '', // endPoint
        '', // clusterId
        '', // attr
        null, // setAttrFromValue
        null // parseValueFromAttr
      );
      node.properties.set('lastSeen', lastSeen);
      lastSeen.value = '';
      lastSeen.fireAndForget = true;

      node.updateLastSeen = () => {
        const d = new Date();
        // there's no easy way to construct an ISO date with local timezone, so do it the hard way
        /* eslint-disable max-len */
        // prettier-ignore
        const s =
          `${d.getFullYear()}-${(`0${d.getMonth() + 1}`).slice(-2)}-${(`0${d.getDate()}`).slice(-2)}
${(`0${d.getHours()}`).slice(-2)}:${(`0${d.getMinutes()}`).slice(-2)}:${(`0${d.getSeconds()}`).slice(-2)}`;
        /* eslint-enable max-len */
        lastSeen.setCachedValueAndNotify(s);
      };
    }
  }

  addProperty(
    node,
    name,
    descr,
    profileId,
    endpoint,
    clusterId,
    attr,
    setAttrFromValue,
    parseValueFromAttr,
    configReport,
    defaultValue
  ) {
    if (typeof profileId === 'string') {
      profileId = parseInt(profileId, 16);
    }
    // Some lights, like the IKEA ones, don't seem to respond to read requests
    // when the profileId is set to ZLL.
    let isZll = false;
    if (profileId == PROFILE_ID.ZLL) {
      isZll = true;
      profileId = PROFILE_ID.ZHA;
    }
    const property = new ZigbeeProperty(
      node,
      name,
      descr,
      profileId,
      endpoint,
      clusterId,
      attr,
      setAttrFromValue,
      parseValueFromAttr
    );
    node.properties.set(name, property);

    DEBUG &&
      console.log(
        'addProperty:',
        node.addr64,
        name,
        `EP:${property.endpoint}`,
        `CL:${Utils.hexStr(property.clusterId, 4)}`
      );

    if (node.hasOwnProperty('devInfoProperties') && node.devInfoProperties.hasOwnProperty(name)) {
      const devInfo = node.devInfoProperties[name];
      if (
        property.endpoint == devInfo.endpoint &&
        property.profileId == devInfo.profileId &&
        property.clusterId == devInfo.clusterId &&
        jsonEqual(property.attr, devInfo.attr)
      ) {
        property.fireAndForget = devInfo.fireAndForget;
        property.value = devInfo.value;
        if (devInfo.hasOwnProperty('minimum')) {
          property.minimum = devInfo.minimum;
        }
        if (devInfo.hasOwnProperty('maximum')) {
          property.maximum = devInfo.maximum;
        }
        if (devInfo.hasOwnProperty('level')) {
          property.level = devInfo.level;
        }
        if (
          devInfo.hasOwnProperty('enum') &&
          property.hasOwnProperty('enum') &&
          property.enum.length == 0
        ) {
          property.enum = devInfo.enum;
        }
      }
    }
    if (isZll) {
      // The ZLL spec says "Attribute reporting shall not be used in this
      // profile", which means that we'll never get reports.
      property.fireAndForget = true;
    }

    property.configReportNeeded = false;
    if (configReport && attr && !property.fireAndForget) {
      property.configReportNeeded = true;
      property.configReport = configReport;
    } else {
      // If we don't enable config reports, then we really need to set
      // fireAndForget, since we're not going to get notified of changes.
      property.fireAndForget = true;
    }

    if (name[0] == '_') {
      property.visible = false;
      // Invisible properties are no longer exposed in Thing Descriptions so
      // should eventually be removed entirely.
      // See https://github.com/WebThingsIO/zigbee-adapter/issues/334
    }
    property.setInitialReadNeeded();
    property.defaultValue = defaultValue;
    property.bindNeeded = property.configReportNeeded;

    DEBUG &&
      console.log(
        'addProperty:   ',
        'fireAndForget:',
        property.fireAndForget,
        'bindNeeded:',
        property.bindNeeded,
        'configReportNeeded:',
        property.configReportNeeded,
        'initialReadNeeded:',
        property.initialReadNeeded
      );

    return property;
  }

  // internal function allows us to use early returns.
  classifyInternal(node) {
    const seMeteringEndpoint = node.findZhaEndpointWithInputClusterIdHex(CLUSTER_ID.SEMETERING_HEX);
    const haElectricalEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.HAELECTRICAL_HEX
    );

    let isZhaLight = false;
    if (seMeteringEndpoint && !isZhaLight) {
      isZhaLight = ZHA_DEVICE_ID.isLight(node.activeEndpoints[seMeteringEndpoint].deviceId);
    }

    if (haElectricalEndpoint && !isZhaLight) {
      isZhaLight = ZHA_DEVICE_ID.isLight(node.activeEndpoints[haElectricalEndpoint].deviceId);
    }

    const genBinaryInputEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.GENBINARYINPUT_HEX
    );
    const genScenesEndpoints = node.findZhaEndpointsWithInputClusterIdHex(CLUSTER_ID.GENSCENES_HEX);
    const genScenesOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.GENSCENES_HEX
    );
    const genGroupsEndpoints = node.findZhaEndpointsWithInputClusterIdHex(CLUSTER_ID.GENGROUPS_HEX);
    const genGroupsOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.GENGROUPS_HEX
    );
    const genLevelCtrlEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.GENLEVELCTRL_HEX
    );
    const genLevelCtrlOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.GENLEVELCTRL_HEX
    );
    const genOnOffEndpoints = node.findZhaEndpointsWithInputClusterIdHex(CLUSTER_ID.GENONOFF_HEX);
    const genOnOffOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.GENONOFF_HEX
    );
    const closuresShadeCfgEndpoints = node.findZhaEndpointsWithInputClusterIdHex(
      CLUSTER_ID.CLOSURESSHADECFG_HEX
    );
    const closuresShadeCfgOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.CLOSURESSHADECFG_HEX
    );
    const closuresWindowCoveringEndpoints = node.findZhaEndpointsWithInputClusterIdHex(
      CLUSTER_ID.CLOSURESWINDOWCOVERING_HEX
    );
    const closuresWindowCoveringOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
      CLUSTER_ID.CLOSURESWINDOWCOVERING_HEX
    );
    const doorLockEndpoint = node.findZhaEndpointWithInputClusterIdHex(CLUSTER_ID.DOORLOCK_HEX);
    const msOccupancySensingEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.OCCUPANCY_SENSOR_HEX
    );
    const msTemperatureEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.TEMPERATURE_HEX
    );
    const hvacThermostatEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.HVACTHERMOSTAT_HEX
    );
    const hvacFanControlEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.HVACFANCTRL_HEX
    );
    const illuminanceEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.ILLUMINANCE_MEASUREMENT_HEX
    );
    const genPowerCfgEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.GENPOWERCFG_HEX
    );
    const genDeviceTempCfgEndpoint = node.findZhaEndpointWithInputClusterIdHex(
      CLUSTER_ID.GENDEVICETEMPCFG_HEX
    );
    const lightLinkEndpoint = node.findZhaEndpointWithInputClusterIdHex(CLUSTER_ID.LIGHTLINK_HEX);
    const ssIasZoneEndpoint = node.findZhaEndpointWithInputClusterIdHex(CLUSTER_ID.SSIASZONE_HEX);
    node.ssIasZoneEndpoint = ssIasZoneEndpoint;

    if (DEBUG) {
      console.log('---- Zigbee classifier -----');
      const listParams = {
        modelId: node.modelId,
        seMeteringEndpoint: seMeteringEndpoint,
        haElectricalEndpoint: haElectricalEndpoint,
        genBinaryInputEndpoint: genBinaryInputEndpoint,
        genScenesEndpoints: genScenesEndpoints,
        genScenesOutputEndpoints: genScenesOutputEndpoints,
        genGroupsEndpoints: genGroupsEndpoints,
        genGroupsOutputEndpoints: genGroupsOutputEndpoints,
        genLevelCtrlEndpoint: genLevelCtrlEndpoint,
        genLevelCtrlOutputEndpoints: genLevelCtrlOutputEndpoints,
        genOnOffEndpoints: genOnOffEndpoints,
        genOnOffOutputEndpoints: genOnOffOutputEndpoints,
        closuresShadeCfgEndpoints: closuresShadeCfgEndpoints,
        closuresShadeCfgOutputEndpoints: closuresShadeCfgOutputEndpoints,
        closuresWindowCoveringEndpoints: closuresWindowCoveringEndpoints,
        closuresWindowCoveringOutputEndpoints: closuresWindowCoveringOutputEndpoints,
        hvacFanControlEndpoint: hvacFanControlEndpoint,
        hvacThermostatEndpoint: hvacThermostatEndpoint,
        doorLockEndpoint: doorLockEndpoint,
        lightingControlEndpoint: node.lightingColorCtrlEndpoint,
        colorCapabilities: node.colorCapabilities,
        colorMode: node.colorMode,
        lightLinkEndpoint: lightLinkEndpoint,
        msOccupancySensingEndpoint: msOccupancySensingEndpoint,
        msTemperatureEndpoint: msTemperatureEndpoint,
        genPowerCfgEndpoint: genPowerCfgEndpoint,
        genDeviceTempCfgEndpoint: genDeviceTempCfgEndpoint,
        zoneType: node.zoneType,
      };
      for (const [key, value] of Object.entries(listParams)) {
        console.log(Utils.padLeft(`${key} =`, 38), value);
      }
    }

    if (typeof node.zoneType !== 'undefined') {
      this.initBinarySensorFromZoneType(node);
    } else if (msOccupancySensingEndpoint) {
      this.initOccupancySensor(node, msOccupancySensingEndpoint);
    } else if (hvacThermostatEndpoint) {
      this.initThermostat(node, hvacThermostatEndpoint, hvacFanControlEndpoint);
    } else if (seMeteringEndpoint && genLevelCtrlEndpoint) {
      // Support Ubisys dimmer D1
      this.initLightingPowerMetering(node, seMeteringEndpoint, genLevelCtrlEndpoint);
    } else if (
      haElectricalEndpoint &&
      !lightLinkEndpoint &&
      !node.lightingColorCtrlEndpoint &&
      !isZhaLight
    ) {
      this.initHaSmartPlug(node, haElectricalEndpoint, seMeteringEndpoint, genLevelCtrlEndpoint);
    } else if (
      seMeteringEndpoint &&
      !lightLinkEndpoint &&
      !node.lightingColorCtrlEndpoint &&
      !isZhaLight
    ) {
      this.initSeSmartPlug(node, seMeteringEndpoint, genLevelCtrlEndpoint);
    } else if (genLevelCtrlEndpoint) {
      this.initMultiLevelSwitch(node, genLevelCtrlEndpoint, lightLinkEndpoint);
    } else if (genOnOffEndpoints.length > 0) {
      this.initOnOffSwitches(node, genOnOffEndpoints);
    } else if (genLevelCtrlOutputEndpoints.length > 0 && genOnOffOutputEndpoints.length > 0) {
      this.initMultiLevelButtons(node, genLevelCtrlOutputEndpoints, genOnOffOutputEndpoints);
    } else if (genOnOffOutputEndpoints.length > 0) {
      this.initOnOffButtons(node, genOnOffOutputEndpoints);
    } else if (doorLockEndpoint) {
      this.initDoorLock(node, doorLockEndpoint);
    } else if (genBinaryInputEndpoint) {
      this.initBinarySensor(node, genBinaryInputEndpoint);
    }

    // Add extra properties, if necessary.
    if (!hvacThermostatEndpoint) {
      if (msTemperatureEndpoint) {
        this.addTemperatureSensorProperty(node, msTemperatureEndpoint);
      } else if (genDeviceTempCfgEndpoint) {
        this.addDeviceTemperatureProperty(node, genDeviceTempCfgEndpoint);
      }
    }
    if (illuminanceEndpoint) {
      this.addIlluminanceMeasurementProperty(node, illuminanceEndpoint);
    }
    if (genPowerCfgEndpoint) {
      this.addPowerCfgVoltageProperty(node, genPowerCfgEndpoint);
    }

    this.addLastSeenProperty(node);
  }

  classify(node) {
    DEBUG && console.log('classify called for node:', node.addr64);

    if (node.isCoordinator) {
      return;
    }

    if (!node.hasOwnProperty('@type')) {
      node['@type'] = [];
    }

    this.classifyInternal(node);

    // Now that we know the type, set the default name.
    node.defaultName = `${node.id}-${node.type}`;
    if (!node.name) {
      node.name = node.defaultName;
    }
    DEBUG &&
      console.log(
        'classify: Initialized as type:',
        node.type,
        'name:',
        node.name,
        'defaultName:',
        node.defaultName
      );
  }

  initBinarySensor(node, endpointNum) {
    node.type = 'sensor';
    node['@type'] = ['BinarySensor'];
    this.addPresentValueProperty(node, endpointNum);
  }

  initBinarySensorFromZoneType(node) {
    node.type = 'sensor';
    let propertyName;
    let propertyDescr;
    let zoneType = node.zoneType;
    if (zoneType == 0 && ZONE_TYPE_ZERO.hasOwnProperty(node.modelId)) {
      zoneType = ZONE_TYPE_ZERO[node.modelId];
    }
    if (ZONE_TYPE_NAME.hasOwnProperty(zoneType)) {
      node.type = ZONE_TYPE_NAME[zoneType].type;
      node['@type'] = ZONE_TYPE_NAME[zoneType]['@type'];
      propertyName = ZONE_TYPE_NAME[zoneType].propertyName;
      propertyDescr = ZONE_TYPE_NAME[zoneType].propertyDescr;
    } else if (zoneType == 0x8000) {
      // The SmartThings button has a zoneType of 0x8000
      node.type = 'button';
      node['@type'] = ['PushButton'];
      this.addEvents(node, {
        pressed: {
          '@type': 'PressedEvent',
          description: 'Button pressed and released quickly',
        },
        doublePressed: {
          '@type': 'DoublePressedEvent',
          description: 'Button pressed and released twice quickly',
        },
        longPressed: {
          '@type': 'LongPressedEvent',
          description: 'Button pressed and held',
        },
      });
      propertyName = null;
      propertyDescr = null;
    } else {
      // This is basically 'just in case' (or unknown zoneType=0)
      node.type = 'sensor';
      node['@type'] = ['BinarySensor'];
      propertyName = 'on';
      propertyDescr = {
        '@type': 'BooleanProperty',
        type: 'boolean',
        label: `ZoneType${zoneType}`,
        descr: `ZoneType${zoneType}`,
      };
    }

    this.addZoneTypeProperty(node, propertyName, propertyDescr);
  }

  initDoorLock(node, doorLockEndpoint) {
    node.type = 'DoorLock';
    node['@type'] = ['Lock'];
    this.addDoorLockedProperty(node, doorLockEndpoint);
  }

  initOccupancySensor(node, msOccupancySensingEndpoint) {
    node['@type'] = ['BinarySensor'];
    node.type = 'sensor';
    node.name = `${node.id}-occupancy`;

    this.addOccupancySensorProperty(node, msOccupancySensingEndpoint);
  }

  initOnOffSwitches(node, genOnOffEndpoints) {
    node.type = 'switch';
    node['@type'] = ['OnOffSwitch'];
    console.log('genOnOffEndpoints =', genOnOffEndpoints);
    for (const idx in genOnOffEndpoints) {
      console.log('Processing endpoing', idx, '=', genOnOffEndpoints[idx]);
      const suffix = idx == 0 ? '' : `${idx}`;
      this.addOnProperty(node, genOnOffEndpoints[idx], suffix);
    }
  }

  initMultiLevelSwitch(node, genLevelCtrlEndpoint, lightLinkEndpoint) {
    node.type = 'switch';
    let colorCapabilities =
      (node.hasOwnProperty('colorCapabilities') && node.colorCapabilities) || 0;
    let isLight = false;
    let isColorLight = false;
    let isColorTemperatureLight = false;

    if (lightLinkEndpoint && node.activeEndpoints[lightLinkEndpoint].deviceId) {
      // The device supports ZLL, check the deviceId associated with the ZLL
      // endpoint to see if its a light or not.
      const zllDeviceId = node.activeEndpoints[lightLinkEndpoint].deviceId;
      if (zllDeviceId == ZLL_DEVICE_ID.ON_OFF_SWITCH) {
        // This isn't really a multi-level switch even though it has a level
        // control. So call the correct routine.
        // The IKEA outlet is an example of a device which falls into this
        // category.
        this.initOnOffSwitches(node, [genLevelCtrlEndpoint]);
        return;
      }
      if (ZLL_DEVICE_ID.isLight(zllDeviceId)) {
        isLight = true;
        if (ZLL_DEVICE_ID.isColorLight(zllDeviceId)) {
          isColorLight = true;
        }
        if (ZLL_DEVICE_ID.isColorTemperatureLight(zllDeviceId)) {
          isColorTemperatureLight = true;
        }
      }
    }
    const levelEndpoint = node.activeEndpoints[genLevelCtrlEndpoint];
    if (levelEndpoint.profileId == PROFILE_ID.ZHA_HEX) {
      if (ZHA_DEVICE_ID.isLight(levelEndpoint.deviceId)) {
        isLight = true;
        if (ZHA_DEVICE_ID.isColorLight(levelEndpoint.deviceId)) {
          // ZHA-only color temperature bulbs are reported as color
          // bulbs by deviceId (The Sylvania Adjustable bulb fits this
          // category) but the colorCapabilities tells the true story.
          if (!node.hasOwnProperty('colorCapabilities')) {
            // We have nothing else to go by. Assume its a color light.
            isColorLight = true;
            colorCapabilities |= COLOR_CAPABILITY.HUE_SAT;
          }
        }
        if (ZHA_DEVICE_ID.isColorTemperatureLight(levelEndpoint.deviceId)) {
          isColorTemperatureLight = true;
        }
      }
    }

    if (isLight) {
      if ((colorCapabilities & COLOR_CAPABILITY.COLOR) != 0) {
        isColorLight = true;
      }
      if ((colorCapabilities & COLOR_CAPABILITY.TEMPERATURE) != 0) {
        isColorTemperatureLight = true;
      }
    }

    if (isLight) {
      node.type = 'light';
      // It looks like a light bulb
      if (isColorLight) {
        // Hue and Saturation (or XY) are supported
        if ((colorCapabilities & COLOR_CAPABILITY.HUE_SAT) != 0) {
          this.addColorProperty(node, node.lightingColorCtrlEndpoint);
        } else if ((colorCapabilities & COLOR_CAPABILITY.XY) != 0) {
          this.addColorXYProperty(node, node.lightingColorCtrlEndpoint);
        }
        node['@type'] = ['Light', 'ColorControl', 'OnOffSwitch'];
      } else if (isColorTemperatureLight) {
        this.addColorTemperatureProperty(node, node.lightingColorCtrlEndpoint);
        this.addBrightnessProperty(node, genLevelCtrlEndpoint);
        node['@type'] = ['Light', 'ColorControl', 'OnOffSwitch'];
      } else {
        this.addBrightnessProperty(node, genLevelCtrlEndpoint);
        node['@type'] = ['Light', 'OnOffSwitch'];
      }
    } else {
      this.addLevelProperty(node, genLevelCtrlEndpoint);
      node['@type'] = ['OnOffSwitch', 'MultiLevelSwitch'];
    }
    this.addOnProperty(node, genLevelCtrlEndpoint);
  }

  initOnOffButtons(node, genOnOffOutputEndpoints) {
    node.type = 'button';
    for (const idx in genOnOffOutputEndpoints) {
      console.log('Processing endpoint', idx, '=', genOnOffOutputEndpoints[idx]);
      const suffix = idx == 0 ? '' : `${idx}`;
      const endpoint = genOnOffOutputEndpoints[idx];

      if (node.modelId.includes('motion')) {
        // The IKEA Motion sensor has a modelId of 'TRADFRI motion sensor'
        node.type = 'motion';
        node['@type'] = ['MotionSensor'];

        this.addButtonMotionProperty(node, endpoint, suffix);
        this.addEvents(node, {
          motion: {
            '@type': 'MotionEvent',
            description: 'Motion detected',
          },
          'no-motion': {
            '@type': 'MotionEvent',
            description: 'Motion timeout',
          },
        });
      } else {
        node['@type'] = ['PushButton'];
        const onOffProperty = this.addButtonOnProperty(node, endpoint, suffix);

        onOffProperty.buttonIndex = 1;

        this.addEvents(node, {
          '1-pressed': {
            '@type': 'PressedEvent',
            description: 'On button pressed and released',
          },
        });
      }
    }
  }

  initMultiLevelButtons(node, genLevelCtrlOutputEndpoints, genOnOffOutputEndpoints) {
    if (node.modelId.includes('motion') && genOnOffOutputEndpoints) {
      // The IKEA Motion sensor has a modelId of 'TRADFRI motion sensor'
      this.initOnOffButtons(node, genOnOffOutputEndpoints);
      return;
    }

    node.type = 'button';
    node['@type'] = ['PushButton'];

    for (const idx in genLevelCtrlOutputEndpoints) {
      DEBUG && console.log('Processing endpoint', idx, '=', genLevelCtrlOutputEndpoints[idx]);
      const suffix = idx == 0 ? '' : `${idx}`;
      const endpoint = genLevelCtrlOutputEndpoints[idx];
      const onOffProperty = this.addButtonOnProperty(node, endpoint, suffix);
      const levelProperty = this.addButtonLevelProperty(node, endpoint, suffix);
      let eventLimit = 2; // to generate the events for the Level buttons

      if (node.modelId === 'TRADFRI remote control') {
        // Workaround: version E1810 (deviceId 0820) is missing the GENSCENES
        // output cluster but still receives updates on that cluster
        const t = node.findZhaEndpointWithOutputClusterIdHex(CLUSTER_ID.GENSCENES_HEX);
        if (
          t.length == 0 &&
          endpoint == 1 &&
          node.activeEndpoints['1'] &&
          node.activeEndpoints['1'].deviceId === '0820'
        ) {
          node.activeEndpoints['1'].outputClusters.push(CLUSTER_ID.GENSCENES_HEX);
          node.activeEndpoints['1'].outputClusters.sort();
        }
        // end of workaround

        const genScenesOutputEndpoints = node.findZhaEndpointWithOutputClusterIdHex(
          CLUSTER_ID.GENSCENES_HEX
        );
        if (genScenesOutputEndpoints[0]) {
          const sceneProperty = this.addButtonSceneProperty(node, genScenesOutputEndpoints[0]);
          sceneProperty.buttonIndex = 4; // this property also covers button 5
          eventLimit = 4; // extend to generate the scene events
        }

        // This is the IKEA remote with a center button and 4 other
        // buttons around the edge. The center button sends a toggle
        // rather than on/off.
        onOffProperty.buttonIndex = 1;
        this.addEvents(node, {
          '1-pressed': {
            '@type': 'PressedEvent',
            description: 'On button pressed and released',
          },
        });

        // The remaining buttons can all generate pressed,
        // longPressed and released events.
        levelProperty.buttonIndex = 2; // this property also covers button 3
        const label = ['Top', 'Bottom', 'Right', 'Left'];
        for (let i = 0; i < eventLimit; i++) {
          this.addEvents(node, {
            [`${i + 2}-pressed`]: {
              '@type': 'PressedEvent',
              description: `${label[i]} button pressed and released`,
            },
            [`${i + 2}-longPressed`]: {
              '@type': 'LongPressedEvent',
              description: `${label[i]} button pressed and held`,
            },
            [`${i + 2}-released`]: {
              '@type': 'ReleasedEvent',
              description: `${label[i]} button released (after being held)`,
            },
          });
        }
        return;
      }

      onOffProperty.buttonIndex = 1;
      this.addEvents(node, {
        '1-pressed': {
          '@type': 'PressedEvent',
          description: 'On button pressed and released',
        },
        '2-pressed': {
          '@type': 'PressedEvent',
          description: 'Off button pressed and released',
        },
      });
      switch (node.modelId) {
        case '3130':
          // This is an OSRAM Lightify dimmer. It has 2 buttons, and they
          // use long presses to do the dimming
          levelProperty.buttonIndex = 1;
          this.addEvents(node, {
            '1-longPressed': {
              '@type': 'LongPressedEvent',
              description: 'On button pressed and held',
            },
            '2-longPressed': {
              '@type': 'LongPressedEvent',
              description: 'Off button pressed and held',
            },
            '1-released': {
              '@type': 'ReleasedEvent',
              description: 'On button released (after being held)',
            },
            '2-released': {
              '@type': 'ReleasedEvent',
              description: 'Off button released (after being held)',
            },
          });
          break;

        case 'RWL020':
        case 'RWL021':
          // This is the Philips Hue Dimmer. It has 4 buttons and uses
          // 2 of the buttons to perform the dimming.
          levelProperty.buttonIndex = 3;
          this.addEvents(node, {
            '3-pressed': {
              '@type': 'PressedEvent',
              description: 'Increase button pressed and released',
            },
            '4-pressed': {
              '@type': 'PressedEvent',
              description: 'Decrease button pressed and released',
            },
          });
          break;
        case 'RC 110':
          if (endpoint === 1) {
            this.addSceneEvents(levelProperty, node);
          }
          break;
      }
    }
  }

  addSceneEvents(levelProperty, node) {
    // endpoint 1 of the RC 110 also controls scenes.
    // The driver treats the scene buttons as level property. Each scene
    // produces a unique level value which is mapped here.
    DEBUG && console.log('Adding Scene Events');
    levelProperty.buttonIndex = 2;
    levelProperty.maximum = 256;
    const eventCodes = [2, 52, 102, 153, 194, 254];
    const eventMappings = {};
    for (const id in eventCodes) {
      const code = eventCodes[id];
      eventMappings[`${code + 2}-pressed`] = {
        '@type': 'PressedEvent',
        description: `Scene ${parseInt(id) + 1}`,
      };
    }
    this.addEvents(node, eventMappings);
  }

  initHaSmartPlug(node, haElectricalEndpoint, seMeteringEndpoint, genLevelCtrlEndpoint) {
    node.type = 'smartplug';
    node['@type'] = ['OnOffSwitch', 'SmartPlug', 'EnergyMonitor'];
    this.addOnProperty(node, haElectricalEndpoint);
    if (genLevelCtrlEndpoint) {
      const endpoint = node.activeEndpoints[genLevelCtrlEndpoint];
      if (
        endpoint.deviceId != ZHA_DEVICE_ID.ON_OFF_SWITCH &&
        endpoint.deviceId != ZHA_DEVICE_ID.ON_OFF_OUTPUT
      ) {
        // The Samsung SmartSwitch advertises the genLevelCtrl cluster,
        // but it doesn't do anything. It also advertises itself as an
        // onOffOutput, so we use that to filter out the level control.
        this.addLevelProperty(node, genLevelCtrlEndpoint);
        node['@type'].push('MultiLevelSwitch');
      }
    }

    this.addHaInstantaneousPowerProperty(node, haElectricalEndpoint);
    this.addHaCurrentProperty(node, haElectricalEndpoint);
    this.addHaFrequencyProperty(node, haElectricalEndpoint);
    this.addHaVoltageProperty(node, haElectricalEndpoint);

    if (seMeteringEndpoint) {
      // Ha SmartPlugs might have seMetering endpoint with energy counter
      this.addSeCurrentSummDeliveredProperty(node, seMeteringEndpoint);
    }
  }

  initSeSmartPlug(node, seMeteringEndpoint, genLevelCtrlEndpoint) {
    node.type = 'smartplug';
    node['@type'] = ['OnOffSwitch', 'SmartPlug', 'EnergyMonitor'];
    this.addOnProperty(node, seMeteringEndpoint);
    if (genLevelCtrlEndpoint) {
      this.addLevelProperty(node, genLevelCtrlEndpoint);
      node['@type'].push('MultiLevelSwitch');
    }
    this.addSeInstantaneousPowerProperty(node, seMeteringEndpoint);
    this.addSeCurrentSummDeliveredProperty(node, seMeteringEndpoint);
  }

  initLightingPowerMetering(node, seMeteringEndpoint, genLevelCtrlEndpoint) {
    node.type = 'light';
    node['@type'] = ['OnOffSwitch', 'Light', 'EnergyMonitor'];
    this.addOnProperty(node, genLevelCtrlEndpoint);
    this.addBrightnessProperty(node, genLevelCtrlEndpoint);
    this.addSeInstantaneousPowerProperty(node, seMeteringEndpoint);
  }

  initThermostat(node, hvacThermostatEndpoint, hvacFanControlEndpoint) {
    node.type = 'thermostat';
    node['@type'] = ['Thermostat'];
    this.addThermostatProperties(node, hvacThermostatEndpoint, hvacFanControlEndpoint);
  }
}

module.exports = new ZigbeeClassifier();
