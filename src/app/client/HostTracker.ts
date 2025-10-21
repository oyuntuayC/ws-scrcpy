import { ManagerClient } from './ManagerClient';
import { Message } from '../../types/Message';
import { MessageError, MessageHosts, MessageType } from '../../common/HostTrackerMessage';
import { ACTION } from '../../common/Action';
import { DeviceTracker as GoogDeviceTracker } from '../googDevice/client/DeviceTracker';
import { DeviceTracker as ApplDeviceTracker } from '../applDevice/client/DeviceTracker';
import { ParamsBase } from '../../types/ParamsBase';
import { HostItem } from '../../types/Configuration';
import { ChannelCode } from '../../common/ChannelCode';

const TAG = '[HostTracker]';

export interface HostTrackerEvents {
    // hosts: HostItem[];
    disconnected: CloseEvent;
    error: string;
}

export class HostTracker extends ManagerClient<ParamsBase, HostTrackerEvents> {
    private static instance?: HostTracker;

    public static start(): void {
        this.getInstance();
    }

    public static getInstance(): HostTracker {
        if (!this.instance) {
            this.instance = new HostTracker();
        }
        return this.instance;
    }

    private trackers: Array<GoogDeviceTracker | ApplDeviceTracker> = [];

    private static extractPasswordFromLocation(): string | undefined {
        try {
            const hash = location.hash.replace(/^#!/, '');
            if (!hash) {
                return undefined;
            }
            const params = new URLSearchParams(hash);
            const value = params.get('password');
            return value && value.length ? value : undefined;
        } catch (error) {
            console.error(TAG, 'Failed to read password from location:', (error as Error).message);
            return undefined;
        }
    }

    constructor() {
        const password = HostTracker.extractPasswordFromLocation();
        const baseParams: ParamsBase = { action: ACTION.LIST_HOSTS };
        if (password) {
            baseParams.password = password;
        }
        super(baseParams);
        this.openNewConnection();
        if (this.ws) {
            this.ws.binaryType = 'arraybuffer';
        }
    }

    protected onSocketClose(ev: CloseEvent): void {
        console.log(TAG, 'WS closed');
        this.emit('disconnected', ev);
    }

    protected onSocketMessage(event: MessageEvent): void {
        let message: Message;
        try {
            // TODO: rewrite to binary
            message = JSON.parse(event.data);
        } catch (error: any) {
            console.error(TAG, error.message);
            console.log(TAG, error.data);
            return;
        }
        switch (message.type) {
            case MessageType.ERROR: {
                const msg = message as MessageError;
                console.error(TAG, msg.data);
                this.emit('error', msg.data);
                break;
            }
            case MessageType.HOSTS: {
                const msg = message as MessageHosts;
                // this.emit('hosts', msg.data);
                if (msg.data.local) {
                    msg.data.local.forEach(({ type }) => {
                        const secure = location.protocol === 'https:';
                        const port = location.port ? parseInt(location.port, 10) : secure ? 443 : 80;
                        const { hostname, pathname } = location;
                        if (type !== 'android' && type !== 'ios') {
                            console.warn(TAG, `Unsupported host type: "${type}"`);
                            return;
                        }
                        const hostItem: HostItem = { useProxy: false, secure, port, hostname, pathname, type };
                        this.startTracker(hostItem);
                    });
                }
                if (msg.data.remote) {
                    msg.data.remote.forEach((item) => this.startTracker(item));
                }
                break;
            }
            default:
                console.log(TAG, `Unknown message type: ${message.type}`);
        }
    }

    private startTracker(hostItem: HostItem): void {
        const password = hostItem.password ?? this.params.password;
        const trackerHostItem = password ? { ...hostItem, password } : hostItem;
        switch (trackerHostItem.type) {
            case 'android':
                this.trackers.push(GoogDeviceTracker.start(trackerHostItem));
                break;
            case 'ios':
                this.trackers.push(ApplDeviceTracker.start(trackerHostItem));
                break;
            default:
                console.warn(TAG, `Unsupported host type: "${hostItem.type}"`);
        }
    }

    protected onSocketOpen(): void {
        // do nothing
    }

    public destroy(): void {
        super.destroy();
        this.trackers.forEach((tracker) => {
            tracker.destroy();
        });
        this.trackers.length = 0;
    }

    protected supportMultiplexing(): boolean {
        return true;
    }

    protected getChannelInitData(): Buffer {
        const code = ChannelCode.HSTS;
        const password = this.params.password;
        if (password) {
            const passwordBuffer = Buffer.from(password, 'utf-8');
            const buffer = Buffer.alloc(code.length + passwordBuffer.length);
            buffer.write(code, 'ascii');
            passwordBuffer.copy(buffer, code.length);
            return buffer;
        }
        const buffer = Buffer.alloc(code.length);
        buffer.write(code, 'ascii');
        return buffer;
    }
}
