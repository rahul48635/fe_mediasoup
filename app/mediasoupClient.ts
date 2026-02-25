import { Device } from "mediasoup-client";
import type {
  Transport,
  Producer,
  Consumer,
  RtpCapabilities,
} from "mediasoup-client/types";

type EventCallback = (...args: any[]) => void;

export class MediasoupClient {
  private ws: WebSocket;
  private device?: Device;
  private participantId: string;
  private producerTransport?: Transport;
  private consumerTransports = new Map<string, Transport>();
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();
  private eventHandlers = new Map<string, EventCallback[]>();
  private pendingConsumerTransportResolve?: (transport: Transport) => void;
  // store existing producers until device is ready
  private pendingExistingProducers: Array<{
    participantId: string;
    producerId: string;
    kind: string;
  }> = [];
  // queue to ensure consumes happen one at a time, preventing race conditions
  private consumeQueue: Promise<MediaStreamTrack | null> = Promise.resolve(null);

  constructor(wsUrl: string, participantId: string) {
    this.participantId = participantId;
    this.ws = new WebSocket(wsUrl);
    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("Received message:", data);

      switch (data.type) {
        case "joined":
          this.emit("joined", data);
          // Don't emit newProducer yet — device not ready.
          // Store them and flush after device loads.
          if (data.existingProducers && data.existingProducers.length > 0) {
            this.pendingExistingProducers = data.existingProducers;
          }
          break;

        case "rtpCapabilities":
          await this.handleRtpCapabilities(data.data);
          break;

        case "producerTransportCreated":
          this.emit("producerTransportCreated", data.data);
          break;

        case "producerTransportConnected":
          this.emit("producerTransportConnected");
          break;

        case "produced":
          this.emit("produced", data.id);
          break;

        case "consumerTransportCreated":
          this.emit("consumerTransportCreated", data.data);
          break;

        case "consumerTransportConnected":
          this.emit("consumerTransportConnected");
          break;

        case "consumed":
          this.emit("consumed", data.data);
          break;

        case "participantJoined":
          this.emit("participantJoined", data.participantId);
          break;

        case "newProducer":
          this.emit("newProducer", {
            participantId: data.participantId,
            producerId: data.producerId,
            kind: data.kind,
          });
          break;

        case "participantLeft":
          this.handleParticipantLeft(data.participantId);
          break;

        case "error":
          console.error("Server error:", data.message);
          break;
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      console.log("WebSocket closed");
    };
  }

  private send(message: Record<string, any>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  public async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.joinRoom();
        resolve();
      } else {
        this.ws.onopen = () => {
          this.joinRoom();
          resolve();
        };
        this.ws.onerror = reject;
      }
    });
  }

  private joinRoom(): void {
    this.send({
      type: "join",
      participantId: this.participantId,
    });

    this.send({
      type: "getRtpCapabilities",
    });
  }

  private async handleRtpCapabilities(
    rtpCapabilities: RtpCapabilities,
  ): Promise<void> {
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    console.log("Device loaded with RTP capabilities");

    // Device is ready now — emit pending existing producers one at a time
    if (this.pendingExistingProducers.length > 0) {
      const producers = [...this.pendingExistingProducers];
      this.pendingExistingProducers = [];
      for (const producer of producers) {
        this.emit("newProducer", {
          participantId: producer.participantId,
          producerId: producer.producerId,
          kind: producer.kind,
        });
      }
    }
  }

  public async produceTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.device) {
      throw new Error("Device not initialized");
    }

    if (!this.producerTransport) {
      await this.createProducerTransport();
    }

    if (!this.producerTransport) {
      throw new Error("Producer transport not created");
    }

    const producer = await this.producerTransport.produce({ track });
    this.producers.set(producer.id, producer);

    console.log(`Producing ${track.kind} track:`, producer.id);
  }

  private async createProducerTransport(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.once("producerTransportCreated", async (data: any) => {
        await this.setupProducerTransport(data);
        resolve();
      });

      this.send({
        type: "createProducerTransport",
        participantId: this.participantId,
      });
    });
  }

  private async setupProducerTransport(transportData: any): Promise<void> {
    if (!this.device) throw new Error("Device not initialized");

    this.producerTransport = this.device.createSendTransport(transportData);

    this.producerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          this.once("producerTransportConnected", () => callback());
          this.send({
            type: "connectProducerTransport",
            participantId: this.participantId,
            transportId: transportData.id,
            dtlsParameters,
          });
        } catch (error) {
          errback(error as Error);
        }
      },
    );

    this.producerTransport.on(
      "produce",
      async ({ kind, rtpParameters }, callback, errback) => {
        try {
          this.once("produced", (id: string) => {
            callback({ id });
          });
          this.send({
            type: "produce",
            participantId: this.participantId,
            transportId: transportData.id,
            kind,
            rtpParameters,
          });
        } catch (error) {
          errback(error as Error);
        }
      },
    );

    this.producerTransport.on("connectionstatechange", (state) => {
      console.log("Producer transport state:", state);
    });
  }

  // FIX: Wrap consumeTrack in a queue so multiple simultaneous calls
  // don't race on consumerTransportCreated / consumed events
  public async consumeTrack(
    producerParticipantId: string,
    producerId: string,
  ): Promise<MediaStreamTrack | null> {
    this.consumeQueue = this.consumeQueue
      .then(() => this._consumeTrack(producerParticipantId, producerId))
      .catch(() => null);
    const track = await this.consumeQueue;
    return track;
  }

  private async _consumeTrack(
    producerParticipantId: string,
    producerId: string,
  ): Promise<MediaStreamTrack | null> {
    if (!this.device) {
      throw new Error("Device not initialized");
    }

    const transportKey = producerParticipantId;
    let consumerTransport = this.consumerTransports.get(transportKey);

    if (!consumerTransport) {
      consumerTransport = await this.createConsumerTransport(transportKey);
    }

    return new Promise<MediaStreamTrack | null>((resolve) => {
      this.once("consumed", async (data: any) => {
        try {
          const consumer = await consumerTransport!.consume({
            id: data.id,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: data.rtpParameters,
          });
          this.consumers.set(consumer.id, consumer);
          resolve(consumer.track);
        } catch (error) {
          console.error("Error consuming track:", error);
          resolve(null);
        }
      });

      this.send({
        type: "consume",
        participantId: this.participantId,
        transportId: consumerTransport!.id,
        producerParticipantId,
        producerId,
        rtpCapabilities: this.device!.rtpCapabilities,
      });
    });
  }

  private async createConsumerTransport(key: string): Promise<Transport> {
    return new Promise<Transport>((resolve) => {
      this.once("consumerTransportCreated", async (data: any) => {
        const transport = await this.setupConsumerTransport(data);
        this.consumerTransports.set(key, transport);
        resolve(transport);
      });

      this.send({
        type: "createConsumerTransport",
        participantId: this.participantId,
      });
    });
  }

  private async setupConsumerTransport(transportData: any): Promise<Transport> {
    if (!this.device) throw new Error("Device not initialized");

    const transport = this.device.createRecvTransport(transportData);

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        this.once("consumerTransportConnected", () => callback());
        this.send({
          type: "connectConsumerTransport",
          participantId: this.participantId,
          transportId: transportData.id,
          dtlsParameters,
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    transport.on("connectionstatechange", (state) => {
      console.log("Consumer transport state:", state);
    });

    return transport;
  }

  private handleParticipantLeft(participantId: string): void {
    const transport = this.consumerTransports.get(participantId);
    if (transport) {
      transport.close();
      this.consumerTransports.delete(participantId);
    }
    this.emit("participantLeft", participantId);
  }

  public disconnect(): void {
    for (const producer of this.producers.values()) {
      producer.close();
    }
    this.producers.clear();

    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    this.consumers.clear();

    this.producerTransport?.close();

    for (const transport of this.consumerTransports.values()) {
      transport.close();
    }
    this.consumerTransports.clear();

    this.ws.close();
  }

  public on(event: string, callback: EventCallback): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(callback);
  }

  private once(event: string, callback: EventCallback): void {
    const wrapper = (...args: any[]) => {
      callback(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  private off(event: string, callback: EventCallback): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }
}
