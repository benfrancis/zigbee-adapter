/**
 *
 * Zigbee2MqttProperty - A Zigbee2Mqtt property.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

import Color from 'color';
import { Property } from 'gateway-addon';
import { Any, PropertyValueType, Property as PropertySchema } from 'gateway-addon/lib/schema';
import { Expos } from './zigbee2mqtt-adapter';
import { Zigbee2MqttDevice } from './zigbee2mqtt-device';
import mqtt from 'mqtt';
import DEBUG_FLAG from '../zb-debug';

function debug(): boolean {
  return DEBUG_FLAG.DEBUG_zigbee2mqtt;
}

export const WRITE_BIT = 0b010;
export const READ_BIT = 0b100;

export function parseType(expose: Expos): PropertyValueType {
  switch (expose.type) {
    case 'numeric':
      if (expose.value_step === 1) {
        return 'integer';
      } else {
        return 'number';
      }
    case 'enum':
      return 'string';
    case 'binary':
      return 'boolean';
  }

  return 'string';
}

export function parseUnit(unit?: string): string | undefined {
  switch (unit) {
    case '°C':
      return 'degree celsius';
  }

  return unit;
}

function isWritable(access: number): boolean {
  return (access & WRITE_BIT) != 0;
}

export function isReadable(access: number): boolean {
  return (access & READ_BIT) != 0;
}

export class Zigbee2MqttProperty<T extends Any> extends Property<T> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    protected expose: Expos,
    private client: mqtt.Client,
    private deviceTopic: string,
    additionalProperties?: PropertySchema
  ) {
    super(device, name, {
      title: expose.name,
      description: expose.description,
      type: parseType(expose),
      unit: parseUnit(expose.unit),
      enum: expose.values,
      minimum: expose.value_min,
      maximum: expose.value_max,
      multipleOf: expose.value_step,
      readOnly: !isWritable(expose.access ?? 0),
      ...additionalProperties,
    });

    if (this.getUnit() == '%') {
      this.setAtType('LevelProperty');
    }

    switch (name) {
      case 'occupancy': {
        const device = (this.getDevice() as unknown) as { '@type': string[] };
        device['@type'].push('MotionSensor');
        this.setAtType('MotionProperty');
        break;
      }
      case 'power': {
        this.setAtType('InstantaneousPowerProperty');
        break;
      }
      case 'voltage': {
        this.setAtType('VoltageProperty');
        break;
      }
      case 'current': {
        this.setAtType('CurrentProperty');
        break;
      }
      case 'local_temperature': {
        this.setTitle('Current temperature');
        this.setAtType('TemperatureProperty');
        break;
      }
      case 'occupied_heating_setpoint': {
        this.setTitle('Target temperature');
        this.setAtType('TargetTemperatureProperty');
        break;
      }
      case 'system_mode': {
        this.setTitle('Mode');
        break;
      }
      case 'pi_heating_demand': {
        this.setTitle('Valve state');
        break;
      }
      case 'battery': {
        this.setTitle('Battery');
        break;
      }
      case 'temperature': {
        device['@type'].push('TemperatureSensor');
        this.setTitle('Temperature');
        this.setAtType('TemperatureProperty');
        break;
      }
      case 'humidity': {
        device['@type'].push('HumiditySensor');
        this.setTitle('Humidity');
        this.setAtType('HumidityProperty');
        break;
      }
      case 'pressure': {
        device['@type'].push('BarometricPressureSensor');
        this.setTitle('Barometric pressure');
        this.setAtType('BarometricPressureProperty');
        break;
      }
      case 'smoke': {
        device['@type'].push('SmokeSensor');
        this.setTitle('Smoke');
        this.setAtType('SmokeProperty');
        break;
      }
      case 'contact': {
        device['@type'].push('DoorSensor');
        this.setTitle('Open');
        this.setAtType('OpenProperty');
        break;
      }
    }
  }

  isReadable(): boolean {
    console.log(`${this.getName()} ${this.expose.access} ${isReadable(this.expose.access ?? 0)}`);
    return isReadable(this.expose.access ?? 0);
  }

  update(value: unknown, _: Record<string, unknown>): void {
    this.setCachedValueAndNotify(value as T);
  }

  async setValue(value: T): Promise<T> {
    const newValue = await super.setValue(value);
    await this.sendValue(newValue);

    return Promise.resolve(newValue);
  }

  protected async sendValue(value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const writeTopic = `${this.deviceTopic}/set`;
      const json = { [this.getName()]: value };

      if (debug()) {
        console.log(`Sending ${JSON.stringify(json)} to ${writeTopic}`);
      }

      this.client.publish(writeTopic, JSON.stringify(json), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

export class OnOffProperty extends Zigbee2MqttProperty<boolean> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    expose: Expos,
    client: mqtt.Client,
    deviceTopic: string
  ) {
    super(device, name, expose, client, deviceTopic, {
      '@type': 'OnOffProperty',
      title: 'On',
      type: parseType(expose),
    });
  }

  update(value: string, update: Record<string, unknown>): void {
    super.update(value === 'ON', update);
  }

  protected async sendValue(value: boolean): Promise<void> {
    return super.sendValue(value ? 'ON' : 'OFF');
  }
}

export class BrightnessProperty extends Zigbee2MqttProperty<number> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    expose: Expos,
    client: mqtt.Client,
    deviceTopic: string
  ) {
    super(device, name, expose, client, deviceTopic, {
      '@type': 'BrightnessProperty',
      title: 'Brightness',
      minimum: 0,
      maximum: 100,
      type: 'number',
      unit: 'percent',
    });
  }

  update(value: number, update: Record<string, unknown>): void {
    const percent = Math.round((value / (this.expose.value_max ?? 100)) * 100);
    super.update(percent, update);
  }

  protected async sendValue(value: number): Promise<void> {
    return super.sendValue(Math.round((value / 100) * (this.expose.value_max ?? 100)));
  }
}

function miredToKelvin(mired: number): number {
  return Math.round(1_000_000 / mired);
}

function kelvinToMiredd(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

export class ColorTemperatureProperty extends Zigbee2MqttProperty<number> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    expose: Expos,
    client: mqtt.Client,
    deviceTopic: string
  ) {
    super(device, name, expose, client, deviceTopic, {
      '@type': 'ColorTemperatureProperty',
      title: 'Color temperature',
      type: 'number',
      minimum: miredToKelvin(expose.value_max!),
      maximum: miredToKelvin(expose.value_min!),
      unit: 'kelvin',
    });
  }

  update(value: number, update: Record<string, unknown>): void {
    super.update(miredToKelvin(value), update);
  }

  protected async sendValue(value: number): Promise<void> {
    return super.sendValue(kelvinToMiredd(value));
  }
}

export class ColorProperty extends Zigbee2MqttProperty<string> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    expose: Expos,
    client: mqtt.Client,
    deviceTopic: string
  ) {
    super(device, name, expose, client, deviceTopic, {
      '@type': 'ColorProperty',
      title: 'Color',
      type: 'string',
      readOnly: false,
    });
  }

  update(value: XY, update: Record<string, unknown>): void {
    const rgb = xyBriToRgb(value.x, value.y, (update.brightness as number) ?? 255);
    const color = new Color(rgb);
    super.update(color.hex(), update);
  }

  protected async sendValue(value: string): Promise<void> {
    const color = new Color(value);
    const rgb = color.object();
    return super.sendValue(rgb);
  }
}

export interface XY {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/*
I tried

Color({
  x: value.x * 100,
  y: value.y * 100,
  z: ((update.brightness as number) ?? 255) * 100 / 255,
}).hex()

but it seems to calculate the wrong color.
If we send #00FF00 to zigbee2mqtt we get {"x":0.1721,"y":0.6905} as answer.
The Color class translates this to #00FFF5.
*/
// https://stackoverflow.com/questions/22894498/philips-hue-convert-xy-from-api-to-hex-or-rgb
function xyBriToRgb(x: number, y: number, bri: number): RGB {
  const z = 1.0 - x - y;

  const Y = bri / 255.0;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r = X * 1.612 - Y * 0.203 - Z * 0.302;
  let g = -X * 0.509 + Y * 1.412 + Z * 0.066;
  let b = X * 0.026 - Y * 0.072 + Z * 0.962;

  r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(r, 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(g, 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(b, 1.0 / 2.4) - 0.055;

  const maxValue = Math.max(r, g, b);

  r /= maxValue;
  g /= maxValue;
  b /= maxValue;

  r = limit(r * 255, 0, 255);
  g = limit(g * 255, 0, 255);
  b = limit(b * 255, 0, 255);

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

function limit(value: number, min: number, max: number): number {
  return Math.max(Math.min(value, max), min);
}

function convertHeatingCoolingValues(value?: string[]): string[] | undefined {
  if (value) {
    return value.map((x) => convertHeatingCoolingValue(x));
  }

  return value;
}

function convertHeatingCoolingValue(value: string): string {
  switch (value) {
    case 'idle':
      return 'off';
    case 'heat':
      return 'heating';
    case 'cool':
      return 'cooling';
    default:
      throw new Error(`Invalid HeatingCoolingValue ${value}, expected idle, heat or cool`);
  }
}

export class HeatingCoolingProperty extends Zigbee2MqttProperty<string> {
  constructor(
    device: Zigbee2MqttDevice,
    name: string,
    expose: Expos,
    client: mqtt.Client,
    deviceTopic: string
  ) {
    super(device, name, expose, client, deviceTopic, {
      '@type': 'HeatingCoolingProperty',
      title: 'Run Mode',
      type: 'string',
      enum: convertHeatingCoolingValues(expose.values),
    });
  }

  update(value: string, update: Record<string, unknown>): void {
    super.update(convertHeatingCoolingValue(value), update);
  }
}
