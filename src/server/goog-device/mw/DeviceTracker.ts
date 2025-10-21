import WS from 'ws';
import { Mw, RequestParameters } from '../../mw/Mw';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { ControlCenter } from '../services/ControlCenter';
import { ACTION } from '../../../common/Action';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { DeviceTrackerEvent } from '../../../types/DeviceTrackerEvent';
import { DeviceTrackerEventList } from '../../../types/DeviceTrackerEventList';
import { Multiplexer } from '../../../packages/multiplexer/Multiplexer';
import { ChannelCode } from '../../../common/ChannelCode';
import { Config } from '../../Config';

export class DeviceTracker extends Mw {
    public static readonly TAG = 'DeviceTracker';
    public static readonly type = 'android';
    private adt: ControlCenter = ControlCenter.getInstance();
    private readonly id: string;

    public static processChannel(ws: Multiplexer, code: string, data?: ArrayBuffer): Mw | undefined {
        if (code !== ChannelCode.GTRC) {
            return;
        }
        if (!this.isAuthorizedForChannel(ws, data)) {
            return;
        }
        return new DeviceTracker(ws);
    }

    public static processRequest(ws: WS, params: RequestParameters): DeviceTracker | undefined {
        if (params.action !== ACTION.GOOG_DEVICE_LIST) {
            return;
        }
        if (!this.isAuthorizedForRequest(ws, params)) {
            return;
        }
        return new DeviceTracker(ws);
    }

    constructor(ws: WS | Multiplexer) {
        super(ws);

        this.id = this.adt.getId();
        this.adt
            .init()
            .then(() => {
                this.adt.on('device', this.sendDeviceMessage);
                this.buildAndSendMessage(this.adt.getDevices());
            })
            .catch((error: Error) => {
                console.error(`[${DeviceTracker.TAG}] Error: ${error.message}`);
            });
    }

    private sendDeviceMessage = (device: GoogDeviceDescriptor): void => {
        const data: DeviceTrackerEvent<GoogDeviceDescriptor> = {
            device,
            id: this.id,
            name: this.adt.getName(),
        };
        this.sendMessage({
            id: -1,
            type: 'device',
            data,
        });
    };

    private buildAndSendMessage = (list: GoogDeviceDescriptor[]): void => {
        const data: DeviceTrackerEventList<GoogDeviceDescriptor> = {
            list,
            id: this.id,
            name: this.adt.getName(),
        };
        this.sendMessage({
            id: -1,
            type: 'devicelist',
            data,
        });
    };

    protected onSocketMessage(event: WS.MessageEvent): void {
        let command: ControlCenterCommand;
        try {
            command = ControlCenterCommand.fromJSON(event.data.toString());
        } catch (error: any) {
            console.error(`[${DeviceTracker.TAG}], Received message: ${event.data}. Error: ${error?.message}`);
            return;
        }
        this.adt.runCommand(command).catch((e) => {
            console.error(`[${DeviceTracker.TAG}], Received message: ${event.data}. Error: ${e.message}`);
        });
    }

    public release(): void {
        super.release();
        this.adt.off('device', this.sendDeviceMessage);
    }

    private static requiredPassword(): string | undefined {
        return Config.getInstance().googTrackerPassword;
    }

    private static isAuthorizedForRequest(ws: WS, params: RequestParameters): boolean {
        const password = this.requiredPassword();
        if (!password) {
            return true;
        }
        const queryPassword = params.url.searchParams.get('password');
        if (queryPassword === password) {
            return true;
        }
        const header = params.request.headers['authorization'];
        const headerValue = Array.isArray(header) ? header[0] : header;
        if (headerValue && this.matchesBasicAuth(headerValue, password)) {
            return true;
        }
        ws.close(1008, 'Unauthorized');
        return false;
    }

    private static isAuthorizedForChannel(ws: Multiplexer, data?: ArrayBuffer): boolean {
        const password = this.requiredPassword();
        if (!password) {
            return true;
        }
        const provided = data ? Buffer.from(data).toString() : '';
        if (provided === password) {
            return true;
        }
        ws.close(1008, 'Unauthorized');
        return false;
    }

    private static matchesBasicAuth(header: string, password: string): boolean {
        const trimmed = header.trim();
        if (!trimmed.toLowerCase().startsWith('basic ')) {
            return false;
        }
        const base64 = trimmed.slice(6).trim();
        try {
            const decoded = Buffer.from(base64, 'base64').toString();
            const separatorIndex = decoded.indexOf(':');
            const candidate = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
            return candidate === password;
        } catch (error) {
            console.error(`[${DeviceTracker.TAG}]`, 'Failed to parse basic auth header:', (error as Error).message);
            return false;
        }
    }
}
