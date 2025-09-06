import { createServer, Socket } from 'net';

interface IRCClient {
  socket: Socket;
  nickname?: string;
  username?: string;
  realname?: string;
  hostname: string;
  registered: boolean;
  channels: Set<string>;
}

interface IRCChannel {
  name: string;
  clients: Set<IRCClient>;
  topic?: string;
}

class IRCServer {
  private clients: Map<Socket, IRCClient> = new Map();
  private channels: Map<string, IRCChannel> = new Map();
  private serverName = 'irc.comicserver.local';
  private version = '1.0.0';

  constructor(private port: number = 6667) {}

  start() {
    const server = createServer((socket) => {
      console.log(`New connection from ${socket.remoteAddress}:${socket.remotePort}`);
      
      const client: IRCClient = {
        socket,
        hostname: socket.remoteAddress || 'unknown',
        registered: false,
        channels: new Set()
      };
      
      this.clients.set(socket, client);

      socket.on('data', (data) => {
        const messages = data.toString('latin1').trim().split('\r\n');
        for (const message of messages) {
          if (message.trim()) {
            this.handleMessage(client, message.trim());
          }
        }
      });

      socket.on('close', () => {
        console.log(`Client ${client.nickname || 'unknown'} disconnected`);
        this.removeClient(client);
      });

      socket.on('error', (err) => {
        console.error('Socket error:', err);
        this.removeClient(client);
      });
    });

    server.listen(this.port, () => {
      console.log(`IRC Server listening on port ${this.port}`);
      console.log(`Compatible with Microsoft Comic Chat`);
    });

    server.on('error', (err) => {
      console.error('Server error:', err);
    });
  }

  private handleMessage(client: IRCClient, message: string) {
    console.log(`<${client.nickname || client.socket.remoteAddress}> ${message}`);
    
    const parts = message.split(' ');
    const command = parts[0].toUpperCase();
    
    switch (command) {
      case 'USER':
        this.handleUser(client, parts);
        break;
      case 'NICK':
        this.handleNick(client, parts);
        break;
      case 'JOIN':
        this.handleJoin(client, parts);
        break;
      case 'PART':
        this.handlePart(client, parts);
        break;
      case 'PRIVMSG':
        this.handlePrivmsg(client, parts);
        break;
      case 'PING':
        this.handlePing(client, parts);
        break;
      case 'QUIT':
        this.handleQuit(client, parts);
        break;
      case 'WHO':
        this.handleWho(client, parts);
        break;
      case 'WHOIS':
        this.handleWhois(client, parts);
        break;
      case 'LIST':
        this.handleList(client, parts);
        break;
      case 'TOPIC':
        this.handleTopic(client, parts);
        break;
      case 'MODE':
        this.handleMode(client, parts);
        break;
      default:
        this.sendReply(client, '421', `${command} :Unknown command`);
    }
  }

  private handleUser(client: IRCClient, parts: string[]) {
    if (parts.length < 5) {
      this.sendReply(client, '461', 'USER :Not enough parameters');
      return;
    }
    
    client.username = parts[1];
    client.realname = parts.slice(4).join(' ').substring(1);
    
    this.checkRegistration(client);
  }

  private handleNick(client: IRCClient, parts: string[]) {
    if (parts.length < 2) {
      this.sendReply(client, '431', ':No nickname given');
      return;
    }

    const newNick = parts[1];
    
    // Check if nickname is already in use
    for (const [, otherClient] of this.clients) {
      if (otherClient !== client && otherClient.nickname === newNick) {
        this.sendReply(client, '433', `${newNick} :Nickname is already in use`);
        return;
      }
    }

    const oldNick = client.nickname;
    client.nickname = newNick;

    if (client.registered && oldNick) {
      // Notify all channels about nick change
      client.channels.forEach(channelName => {
        const channel = this.channels.get(channelName);
        if (channel) {
          this.broadcastToChannel(channel, `:${oldNick}!${client.username}@${client.hostname} NICK :${newNick}`, client);
        }
      });
    }

    this.checkRegistration(client);
  }

  private checkRegistration(client: IRCClient) {
    if (!client.registered && client.nickname && client.username) {
      client.registered = true;
      
      this.sendReply(client, '001', `:Welcome to the Comic Chat IRC Network ${client.nickname}!${client.username}@${client.hostname}`);
      this.sendReply(client, '002', `:Your host is ${this.serverName}, running version ${this.version}`);
      this.sendReply(client, '003', `:This server was created for Microsoft Comic Chat compatibility`);
      this.sendReply(client, '004', `${this.serverName} ${this.version} - -`);
    }
  }

  private handleJoin(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '461', 'JOIN :Not enough parameters');
      return;
    }

    const channelName = parts[1];
    
    if (!channelName.startsWith('#')) {
      this.sendReply(client, '403', `${channelName} :No such channel`);
      return;
    }

    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = {
        name: channelName,
        clients: new Set(),
        topic: undefined
      };
      this.channels.set(channelName, channel);
    }

    if (channel.clients.has(client)) {
      return; // Already in channel
    }

    channel.clients.add(client);
    client.channels.add(channelName);

    // Send JOIN confirmation to client
    this.send(client, `:${client.nickname}!${client.username}@${client.hostname} JOIN :${channelName}`);
    
    // Send topic if exists
    if (channel.topic) {
      this.sendReply(client, '332', `${channelName} :${channel.topic}`);
    }

    // Send names list
    const names = Array.from(channel.clients).map(c => c.nickname).join(' ');
    this.sendReply(client, '353', `= ${channelName} :${names}`);
    this.sendReply(client, '366', `${channelName} :End of /NAMES list`);

    // Broadcast JOIN to other users in channel
    this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} JOIN :${channelName}`, client);
  }

  private handlePart(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '461', 'PART :Not enough parameters');
      return;
    }

    const channelName = parts[1];
    const channel = this.channels.get(channelName);

    if (!channel || !channel.clients.has(client)) {
      this.sendReply(client, '442', `${channelName} :You're not on that channel`);
      return;
    }

    const partMessage = parts.slice(2).join(' ');
    const fullMessage = partMessage ? ` :${partMessage.startsWith(':') ? partMessage.substring(1) : partMessage}` : '';

    // Broadcast PART to channel
    this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} PART ${channelName}${fullMessage}`);

    // Remove client from channel
    channel.clients.delete(client);
    client.channels.delete(channelName);

    // Remove empty channel
    if (channel.clients.size === 0) {
      this.channels.delete(channelName);
    }
  }

  private handlePrivmsg(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 3) {
      this.sendReply(client, '461', 'PRIVMSG :Not enough parameters');
      return;
    }

    const target = parts[1];
    const message = parts.slice(2).join(' ').substring(1);

    if (target.startsWith('#')) {
      // Channel message
      const channel = this.channels.get(target);
      if (!channel || !channel.clients.has(client)) {
        this.sendReply(client, '404', `${target} :Cannot send to channel`);
        return;
      }

      this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} PRIVMSG ${target} :${message}`, client);
    } else {
      // Private message
      const targetClient = this.findClientByNickname(target);
      if (!targetClient) {
        this.sendReply(client, '401', `${target} :No such nick/channel`);
        return;
      }

      this.send(targetClient, `:${client.nickname}!${client.username}@${client.hostname} PRIVMSG ${target} :${message}`);
    }
  }

  private handlePing(client: IRCClient, parts: string[]) {
    if (parts.length < 2) {
      this.sendReply(client, '461', 'PING :Not enough parameters');
      return;
    }

    this.send(client, `PONG ${this.serverName} :${parts[1]}`);
  }

  private handleQuit(client: IRCClient, parts: string[]) {
    const quitMessage = parts.slice(1).join(' ').substring(1) || 'Client Quit';
    
    // Broadcast QUIT to all channels
    client.channels.forEach(channelName => {
      const channel = this.channels.get(channelName);
      if (channel) {
        this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} QUIT :${quitMessage}`, client);
      }
    });

    this.removeClient(client);
  }

  private handleWho(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '315', '* :End of /WHO list');
      return;
    }

    const target = parts[1];
    if (target.startsWith('#')) {
      const channel = this.channels.get(target);
      if (channel && channel.clients.has(client)) {
        channel.clients.forEach(c => {
          if (c.nickname) {
            this.sendReply(client, '352', `${target} ${c.username} ${c.hostname} ${this.serverName} ${c.nickname} H :0 ${c.realname}`);
          }
        });
      }
    }
    
    this.sendReply(client, '315', `${target} :End of /WHO list`);
  }

  private handleWhois(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '431', ':No nickname given');
      return;
    }

    const target = parts[1];
    const targetClient = this.findClientByNickname(target);
    
    if (!targetClient) {
      this.sendReply(client, '401', `${target} :No such nick/channel`);
      return;
    }

    this.sendReply(client, '311', `${target} ${targetClient.username} ${targetClient.hostname} * :${targetClient.realname}`);
    
    const channels = Array.from(targetClient.channels).join(' ');
    if (channels) {
      this.sendReply(client, '319', `${target} :${channels}`);
    }
    
    this.sendReply(client, '312', `${target} ${this.serverName} :Comic Chat IRC Server`);
    this.sendReply(client, '318', `${target} :End of /WHOIS list`);
  }

  private handleList(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    this.sendReply(client, '321', 'Channel :Users  Name');
    
    this.channels.forEach(channel => {
      const topic = channel.topic || '';
      this.sendReply(client, '322', `${channel.name} ${channel.clients.size} :${topic}`);
    });

    this.sendReply(client, '323', ':End of /LIST');
  }

  private handleTopic(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '461', 'TOPIC :Not enough parameters');
      return;
    }

    const channelName = parts[1];
    const channel = this.channels.get(channelName);

    if (!channel || !channel.clients.has(client)) {
      this.sendReply(client, '442', `${channelName} :You're not on that channel`);
      return;
    }

    if (parts.length === 2) {
      // Get topic
      if (channel.topic) {
        this.sendReply(client, '332', `${channelName} :${channel.topic}`);
      } else {
        this.sendReply(client, '331', `${channelName} :No topic is set`);
      }
    } else {
      // Set topic
      const topic = parts.slice(2).join(' ').substring(1);
      channel.topic = topic;

      this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} TOPIC ${channelName} :${topic}`);
    }
  }

  private handleMode(client: IRCClient, parts: string[]) {
    if (!client.registered) {
      this.sendReply(client, '451', ':You have not registered');
      return;
    }

    if (parts.length < 2) {
      this.sendReply(client, '461', 'MODE :Not enough parameters');
      return;
    }

    const target = parts[1];

    if (target === client.nickname) {
      // User mode query/set
      if (parts.length === 2) {
        // Query user modes - Comic Chat expects a simple response
        this.sendReply(client, '221', '+');
      } else {
        // Set user modes - just acknowledge for Comic Chat compatibility
        const modes = parts[2];
        this.send(client, `:${client.nickname}!${client.username}@${client.hostname} MODE ${client.nickname} ${modes}`);
      }
    } else if (target.startsWith('#')) {
      // Channel mode query/set
      const channel = this.channels.get(target);
      if (!channel || !channel.clients.has(client)) {
        this.sendReply(client, '442', `${target} :You're not on that channel`);
        return;
      }

      if (parts.length === 2) {
        // Query channel modes - simple response for Comic Chat
        this.sendReply(client, '324', `${target} +`);
      } else {
        // Set channel modes - just acknowledge for Comic Chat compatibility
        const modes = parts.slice(2).join(' ');
        this.broadcastToChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} MODE ${target} ${modes}`);
      }
    } else {
      this.sendReply(client, '401', `${target} :No such nick/channel`);
    }
  }

  private findClientByNickname(nickname: string): IRCClient | undefined {
    for (const [, client] of this.clients) {
      if (client.nickname === nickname) {
        return client;
      }
    }
    return undefined;
  }

  private broadcastToChannel(channel: IRCChannel, message: string, excludeClient?: IRCClient) {
    channel.clients.forEach(client => {
      if (client !== excludeClient && client.socket.writable) {
        this.send(client, message);
      }
    });
  }

  private removeClient(client: IRCClient) {
    // Remove from all channels
    client.channels.forEach(channelName => {
      const channel = this.channels.get(channelName);
      if (channel) {
        channel.clients.delete(client);
        if (channel.clients.size === 0) {
          this.channels.delete(channelName);
        }
      }
    });

    this.clients.delete(client.socket);
    
    if (!client.socket.destroyed) {
      client.socket.destroy();
    }
  }

  private send(client: IRCClient, message: string) {
    if (client.socket.writable) {
      console.log(`>${client.nickname || client.socket.remoteAddress} ${message}`);
      client.socket.write(Buffer.from(message + '\r\n', 'latin1'));
    }
  }

  private sendReply(client: IRCClient, code: string, message: string) {
    const nick = client.nickname || '*';
    this.send(client, `:${this.serverName} ${code} ${nick} ${message}`);
  }
}

const server = new IRCServer(6667);
server.start();